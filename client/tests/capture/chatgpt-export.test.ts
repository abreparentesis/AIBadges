import { describe, it, expect } from 'vitest';
import { buildChatGptExport, exportSize } from '../../src/capture/chatgpt-export';
import type { RawConversation } from '../../src/capture/types';

const convo = (id: string, createdAt: string, msgs: [string, string][]): RawConversation => ({
  id, title: 'a chat', createdAt,
  messages: msgs.map(([role, text]) => ({ role: role as 'user' | 'assistant', text, createdAt })),
});

describe('buildChatGptExport', () => {
  it('assigns synthetic ids, keeps real ids in idMap off the export, and preserves order', () => {
    const { export: exp, idMap } = buildChatGptExport([
      convo('uuid-A', '2026-01-01T00:00:00Z', [['user', 'hi'], ['assistant', 'hello']]),
      convo('uuid-B', '2026-02-01T00:00:00Z', [['user', 'second']]),
    ], '2026-06-08T00:00:00Z');

    expect(exp.conversations.map((c) => c.conversationId)).toEqual(['c1', 'c2']);
    expect(idMap).toEqual({ c1: 'uuid-A', c2: 'uuid-B' });
    // Real UUIDs must not leak into the payload handed to the third-party GPT.
    expect(JSON.stringify(exp)).not.toContain('uuid-A');
    expect(exp.conversations[0].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(exp.conversations[0].messages).toHaveLength(2);
  });

  it('truncates each conversation to the per-conversation char budget', () => {
    const big = convo('uuid-A', '2026-01-01T00:00:00Z', [
      ['user', 'x'.repeat(5000)], ['assistant', 'y'.repeat(5000)], ['user', 'z'.repeat(5000)],
    ]);
    const { export: exp } = buildChatGptExport([big], '2026-06-08T00:00:00Z', { perConvoChars: 6000 });
    const chars = exp.conversations[0].messages.reduce((n, m) => n + m.text.length, 0);
    expect(chars).toBeLessThanOrEqual(6000);
    expect(exportSize({ export: exp, idMap: {}, capturedAt: '' })).toBeLessThanOrEqual(6000);
  });

  it('user-centric: keeps user turns in full and clips assistant turns to the head', () => {
    const c = convo('uuid-A', '2026-01-01T00:00:00Z', [
      ['user', 'u'.repeat(300)], ['assistant', 'a'.repeat(3000)], ['user', 'w'.repeat(300)], ['assistant', 'b'.repeat(3000)],
    ]);
    const { export: exp } = buildChatGptExport([c], '2026-06-08T00:00:00Z', { perConvoChars: 2500, assistantHeadChars: 150 });
    const msgs = exp.conversations[0].messages;
    // Both user turns survive in full — the whole arc, not just the opening exchange.
    const users = msgs.filter((m) => m.role === 'user');
    expect(users).toHaveLength(2);
    expect(users.every((m) => m.text.length === 300)).toBe(true);
    // Assistant turns are clipped to the head.
    expect(msgs.filter((m) => m.role === 'assistant').every((m) => m.text.length <= 150)).toBe(true);
  });

  it('skips conversations that come out empty', () => {
    const { export: exp, idMap } = buildChatGptExport([
      convo('uuid-A', '2026-01-01T00:00:00Z', [['user', '']]),
      convo('uuid-B', '2026-02-01T00:00:00Z', [['user', 'real']]),
    ], '2026-06-08T00:00:00Z');
    expect(exp.conversations).toHaveLength(1);
    expect(exp.conversations[0].conversationId).toBe('c1');
    expect(idMap).toEqual({ c1: 'uuid-B' });
  });
});
