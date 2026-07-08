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

  // A capture is ~90 sequential reads; one transient 503/429 must not kill the whole run.
  const noSleep = async () => { /* tests never wait */ };
  const seq = (responses: Array<{ status: number; body?: unknown } | 'network'>) => {
    let i = 0;
    const calls = () => i;
    const fetchFn = async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r === 'network') throw new TypeError('fetch failed');
      return { ok: r.status === 200, status: r.status, json: async () => r.body } as unknown as Response;
    };
    return { fetchFn, calls };
  };

  it('retries a 503 with backoff and succeeds', async () => {
    const { fetchFn, calls } = seq([{ status: 503 }, { status: 503 }, { status: 200, body: fixture }]);
    const adapter = new ClaudeCaptureAdapter('org', fetchFn, noSleep);
    const convo = await adapter.fetchConversation('c1');
    expect(convo.id).toBe('c1');
    expect(calls()).toBe(3);
  });

  it('retries thrown network errors and 429s too', async () => {
    const { fetchFn } = seq(['network', { status: 429 }, { status: 200, body: [] }]);
    const adapter = new ClaudeCaptureAdapter('org', fetchFn, noSleep);
    expect(await adapter.listConversations()).toEqual([]);
  });

  it('gives up after the retry budget with a plain-language error', async () => {
    const { fetchFn, calls } = seq([{ status: 503 }]);
    const adapter = new ClaudeCaptureAdapter('org', fetchFn, noSleep);
    await expect(adapter.fetchConversation('c1')).rejects.toThrow(/temporary error.*503.*profile was kept/s);
    expect(calls()).toBe(4); // initial + 3 retries
  });

  it('fails 4xx immediately — retrying will not fix auth or a missing conversation', async () => {
    const { fetchFn, calls } = seq([{ status: 401 }]);
    const adapter = new ClaudeCaptureAdapter('org', fetchFn, noSleep);
    await expect(adapter.fetchConversation('c1')).rejects.toThrow('fetch failed: 401');
    expect(calls()).toBe(1);
  });
});
