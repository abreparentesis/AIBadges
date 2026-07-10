import { describe, it, expect } from 'vitest';
import { InSessionClaudeCaller, extractTextFromSse, isRateLimitError } from '../../src/inference/in-session';

// Mirrors the real Claude.ai SSE shape captured in the Task 15 spike (CRLF-delimited).
const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"role":"assistant"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\r\n');

// Claude.ai's older browser completion endpoint streams text in `completion`, not
// a Messages API content block. This is the shape returned in the reported failure.
const LEGACY_SSE = [
  'event: completion',
  'data: {"type":"completion","completion":"{\\"aiFluency\\":"}',
  '',
  'event: completion',
  'data: {"type":"completion","completion":"{}}"}',
  '',
].join('\r\n');

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

describe('extractTextFromSse', () => {
  it('concatenates text_delta chunks and ignores other events', () => {
    expect(extractTextFromSse(SSE)).toBe('OK');
  });
  it('concatenates legacy completion chunks from Claude.ai', () => {
    expect(extractTextFromSse(LEGACY_SSE)).toBe('{"aiFluency":{}}');
  });
  it('does not duplicate text when both stream shapes are present', () => {
    expect(extractTextFromSse(`${SSE}\n${LEGACY_SSE}`)).toBe('OK');
  });
  it('returns empty string when there are no text deltas', () => {
    expect(extractTextFromSse('event: ping\r\ndata: {"type":"ping"}\r\n\r\n')).toBe('');
  });
});

describe('InSessionClaudeCaller', () => {
  it('creates a scratch conversation, streams the completion, and deletes it', async () => {
    const calls: { method: string; url: string }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) {
        return { ok: true, status: 200, text: async () => SSE } as unknown as Response;
      }
      if (method === 'DELETE') return { ok: true, status: 204 } as unknown as Response;
      throw new Error(`unexpected ${method} ${url}`);
    };
    const caller = new InSessionClaudeCaller('org1', 'claude-x', fetchFn);
    const out = await caller.complete('hello');
    expect(out).toBe('OK');
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith('/chat_conversations'))).toBe(true);
    expect(calls.some(c => c.url.includes('/completion'))).toBe(true);
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  it('does not send a historical per-call model id when the caller has no pinned model', async () => {
    let completionBody: Record<string, unknown> | null = null;
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) {
        completionBody = JSON.parse(String(init?.body));
        return { ok: true, status: 200, text: async () => SSE } as unknown as Response;
      }
      if (method === 'DELETE') return { ok: true, status: 204 } as unknown as Response;
      throw new Error(`unexpected ${method} ${url}`);
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn);
    await caller.complete('hello', { model: 'stale-history-model' });
    expect(completionBody?.model).toBeUndefined();
  });

  it('reads the saved assistant message when Claude uses an unknown stream envelope', async () => {
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) {
        return { ok: true, status: 200, text: async () => 'data: {"type":"unknown_envelope"}\n\n' } as unknown as Response;
      }
      if (method === 'GET' && url.includes('tree=True')) {
        return {
          ok: true, status: 200,
          json: async () => ({ chat_messages: [
            { sender: 'human', text: 'ignored' },
            { sender: 'assistant', content: [{ type: 'text', text: '{"aiFluency":{}}' }] },
          ] }),
        } as unknown as Response;
      }
      if (method === 'DELETE') return { ok: true, status: 204 } as unknown as Response;
      throw new Error(`unexpected ${method} ${url}`);
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn);
    await expect(caller.complete('hello')).resolves.toBe('{"aiFluency":{}}');
  });

  it('still deletes the scratch conversation when the completion fails', async () => {
    let deleted = false;
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) return { ok: false, status: 500, text: async () => '' } as unknown as Response;
      if (method === 'DELETE') { deleted = true; return { ok: true, status: 204 } as unknown as Response; }
      throw new Error('unexpected');
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn);
    await expect(caller.complete('hello')).rejects.toThrow();
    expect(deleted).toBe(true);
  });

  it('aborts and cleans up when a completion stalls past the timeout', async () => {
    let deleted = false;
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      if (url.includes('/completion')) {
        // never resolves on its own — only rejects when the abort signal fires
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (method === 'DELETE') { deleted = true; return { ok: true, status: 204 } as unknown as Response; }
      throw new Error('unexpected');
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn);
    await expect(caller.complete('hello', { timeoutMs: 40 })).rejects.toThrow();
    expect(deleted).toBe(true);
  });

  it('backs off and retries on a 429, then succeeds', async () => {
    let completionCalls = 0;
    const deletes: string[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) {
        completionCalls += 1;
        if (completionCalls === 1) {
          return { ok: false, status: 429, headers: { get: () => null }, text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, text: async () => SSE } as unknown as Response;
      }
      if (method === 'DELETE') { deletes.push(url); return { ok: true, status: 204 } as unknown as Response; }
      throw new Error('unexpected');
    };
    // retryBaseMs = 1 so the backoff is effectively instant in the test
    const caller = new InSessionClaudeCaller('org1', null, fetchFn, 1);
    const out = await caller.complete('hello');
    expect(out).toBe('OK');
    expect(completionCalls).toBe(2);     // first 429, retried once, then 200
    expect(deletes.length).toBe(2);      // each attempt cleans up its scratch conversation
  });

  it('throws a RateLimitError (no retry) when a 429 reports an exceeded usage window', async () => {
    // Mirrors the real Claude.ai body: error.message is a JSON string with per-window status.
    const limitBody = JSON.stringify({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: JSON.stringify({
          type: 'exceeded_limit', resetsAt: 1780927200, representativeClaim: 'seven_day',
          windows: { '5h': { status: 'within_limit' }, '7d': { status: 'exceeded_limit', resets_at: 1780927200 } },
        }),
      },
    });
    let completionCalls = 0;
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) { completionCalls += 1; return { ok: false, status: 429, headers: { get: () => null }, text: async () => limitBody } as unknown as Response; }
      if (method === 'DELETE') return { ok: true, status: 204 } as unknown as Response;
      throw new Error('unexpected');
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn, 1);
    const err = await caller.complete('hello').then(() => null, (e) => e);
    expect(isRateLimitError(err)).toBe(true);
    expect(err.resetsAt).toBe(1780927200);
    expect(err.windowKey).toBe('7d');
    expect(completionCalls).toBe(1); // exceeded usage cap -> no pointless backoff/retry
  });

  it('does not retry a non-retryable status (500) and still cleans up', async () => {
    let completionCalls = 0;
    let deleted = false;
    const fetchFn: FetchFn = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/chat_conversations')) {
        return { ok: true, status: 201, json: async () => ({ uuid: 's1' }) } as unknown as Response;
      }
      if (url.includes('/completion')) { completionCalls += 1; return { ok: false, status: 500, text: async () => '' } as unknown as Response; }
      if (method === 'DELETE') { deleted = true; return { ok: true, status: 204 } as unknown as Response; }
      throw new Error('unexpected');
    };
    const caller = new InSessionClaudeCaller('org1', null, fetchFn, 1);
    await expect(caller.complete('hello')).rejects.toThrow();
    expect(completionCalls).toBe(1);     // 500 is not retried
    expect(deleted).toBe(true);
  });
});

describe('abortAll (the Stop button)', () => {
  it('aborts an in-flight completion and refuses further calls with CancelledError', async () => {
    const { InSessionClaudeCaller, isCancelledError } = await import('../../src/inference/in-session');
    // fetch that resolves conversation-create instantly, then hangs on the completion until aborted
    const fetchFn = (url: string, init?: RequestInit) => {
      if (url.endsWith('/chat_conversations')) return Promise.resolve(new Response('{}', { status: 200 }));
      if (init?.method === 'DELETE') return Promise.resolve(new Response('{}', { status: 200 }));
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const caller = new InSessionClaudeCaller('org', null, fetchFn as any, 1);
    const inflight = caller.complete('prompt');
    await new Promise((r) => setTimeout(r, 20)); // let it reach the hanging completion fetch
    caller.abortAll();
    await expect(inflight).rejects.toSatisfy(isCancelledError);
    await expect(caller.complete('another')).rejects.toSatisfy(isCancelledError);
  });
});
