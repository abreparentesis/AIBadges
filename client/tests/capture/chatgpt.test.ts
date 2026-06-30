import { describe, it, expect } from 'vitest';
import { ChatGPTCaptureAdapter, linearizeMapping } from '../../src/capture/chatgpt';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const json = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body } as unknown as Response);

// A realistic ChatGPT conversation-detail mapping (tree, out-of-order, with system + tool nodes).
const mapping = {
  root: { id: 'root', message: null, parent: null, children: ['sys'] },
  sys: { id: 'sys', message: { author: { role: 'system' }, create_time: 100, content: { content_type: 'text', parts: ['you are helpful'] } }, parent: 'root', children: ['u1'] },
  a1: { id: 'a1', message: { author: { role: 'assistant' }, create_time: 103, content: { content_type: 'text', parts: ['List the seams first.'] } }, parent: 'u1', children: [] },
  u1: { id: 'u1', message: { author: { role: 'user' }, create_time: 102, content: { content_type: 'text', parts: ['How do I split a 2000-line file?'] } }, parent: 'sys', children: ['tool1'] },
  tool1: { id: 'tool1', message: { author: { role: 'tool' }, create_time: 102.5, content: { content_type: 'text', parts: ['(search results)'] } }, parent: 'u1', children: ['a1'] },
  u2: { id: 'u2', message: { author: { role: 'user' }, create_time: 104, content: { content_type: 'multimodal_text', parts: ['', { image: 'x' }, 'and verify before fixing'] } }, parent: 'a1', children: [] },
};

describe('linearizeMapping', () => {
  it('returns only user/assistant text messages, in create_time order', () => {
    const msgs = linearizeMapping(mapping as any);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']); // sys + tool dropped, time-ordered
    expect(msgs[0].text).toBe('How do I split a 2000-line file?');
    expect(msgs[1].text).toBe('List the seams first.');
    expect(msgs[2].text).toBe('and verify before fixing'); // non-string parts filtered out
    expect(msgs[0].createdAt).toBe(new Date(102 * 1000).toISOString());
  });
  it('handles an empty/absent mapping', () => {
    expect(linearizeMapping(undefined)).toEqual([]);
    expect(linearizeMapping({} as any)).toEqual([]);
  });

  it('walks the active branch from current_node when create_time is null', () => {
    const tree = {
      root: { id: 'root', message: null, parent: null, children: ['u1'] },
      u1: { id: 'u1', message: { author: { role: 'user' }, create_time: null, content: { content_type: 'text', parts: ['first question'] } }, parent: 'root', children: ['a1'] },
      a1: { id: 'a1', message: { author: { role: 'assistant' }, create_time: null, content: { content_type: 'text', parts: ['first answer'] } }, parent: 'u1', children: ['u2', 'u2alt'] },
      u2alt: { id: 'u2alt', message: { author: { role: 'user' }, create_time: null, content: { content_type: 'text', parts: ['ABANDONED branch edit'] } }, parent: 'a1', children: [] },
      u2: { id: 'u2', message: { author: { role: 'user' }, create_time: null, content: { content_type: 'text', parts: ['second question'] } }, parent: 'a1', children: [] },
    };
    const msgs = linearizeMapping(tree as any, 'u2'); // active leaf = u2, not the abandoned u2alt branch
    expect(msgs.map((m) => m.text)).toEqual(['first question', 'first answer', 'second question']);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('ChatGPTCaptureAdapter.listConversations', () => {
  it('uses the session token, paginates, and normalizes timestamps to ISO', async () => {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push(url);
      if (url.endsWith('/api/auth/session')) return json({ accessToken: 'tok-123' });
      if (url.includes('/backend-api/conversations')) {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok-123');
        if (url.includes('offset=0')) {
          // a full page of 100 -> adapter must request the next page
          const items = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, update_time: 1700000000 + i }));
          return json({ items });
        }
        return json({ items: [{ id: 'c100', update_time: 1700000200 }] }); // short page -> stop
      }
      throw new Error(`unexpected ${url}`);
    };
    const out = await new ChatGPTCaptureAdapter(fetchFn).listConversations();
    expect(out.length).toBe(101);
    expect(out[0]).toEqual({ id: 'c0', updatedAt: new Date(1700000000 * 1000).toISOString() });
    expect(calls.filter((u) => u.includes('/backend-api/conversations')).length).toBe(2); // paginated
  });

  it('throws a clear error when not logged in', async () => {
    const fetchFn: FetchFn = async (url) => (url.endsWith('/api/auth/session') ? json({}, true, 200) : json({}, false, 401));
    await expect(new ChatGPTCaptureAdapter(fetchFn).listConversations()).rejects.toThrow(/not logged into chatgpt/i);
  });
});

describe('ChatGPTCaptureAdapter.fetchConversation', () => {
  it('fetches a conversation and linearizes its mapping', async () => {
    const fetchFn: FetchFn = async (url) => {
      if (url.endsWith('/api/auth/session')) return json({ accessToken: 'tok-123' });
      if (url.includes('/backend-api/conversation/')) return json({ title: 'Refactoring', create_time: 101, mapping });
      throw new Error(`unexpected ${url}`);
    };
    const convo = await new ChatGPTCaptureAdapter(fetchFn).fetchConversation('abc');
    expect(convo.id).toBe('abc');
    expect(convo.title).toBe('Refactoring');
    expect(convo.createdAt).toBe(new Date(101 * 1000).toISOString());
    expect(convo.messages).toHaveLength(3);
    expect(convo.messages[0].role).toBe('user');
  });
});
