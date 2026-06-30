import { describe, it, expect } from 'vitest';
import { ClaudeCaptureAdapter } from '../../src/capture/claude';
import fixture from '../fixtures/claude-conversation.json';

function fakeFetch(body: unknown) {
  return async () => ({ ok: true, json: async () => body }) as unknown as Response;
}

describe('ClaudeCaptureAdapter', () => {
  it('maps a conversation response into RawConversation', async () => {
    const adapter = new ClaudeCaptureAdapter('org123', fakeFetch(fixture));
    const convo = await adapter.fetchConversation('c1');
    expect(convo.id).toBe('c1');
    expect(convo.title).toBe('Refactor plan');
    expect(convo.messages).toHaveLength(2);
    expect(convo.messages[0]).toEqual({ role: 'user', text: 'List the seams first.', createdAt: '2026-01-10T09:00:00Z' });
    expect(convo.messages[1].role).toBe('assistant');
  });

  it('reads text from content blocks when the flat text field is empty', async () => {
    const withBlocks = {
      uuid: 'c2', name: 'Blocks', created_at: '2026-01-01T00:00:00Z',
      chat_messages: [
        { sender: 'human', text: '', content: [{ type: 'text', text: 'hello from a content block' }], created_at: '2026-01-01T00:00:00Z' },
        { sender: 'assistant', text: '', content: [{ type: 'thinking', text: 'internal reasoning' }, { type: 'text', text: 'visible reply' }], created_at: '2026-01-01T00:01:00Z' },
      ],
    };
    const adapter = new ClaudeCaptureAdapter('org', fakeFetch(withBlocks));
    const convo = await adapter.fetchConversation('c2');
    expect(convo.messages[0].text).toBe('hello from a content block');
    expect(convo.messages[1].text).toBe('visible reply'); // thinking block excluded
  });
});
