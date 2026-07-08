import type { CaptureAdapter, RawConversation, RawMessage } from './types';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface ClaudeContentBlock { type?: string; text?: string }
interface ClaudeMessage { sender: string; text?: string; content?: ClaudeContentBlock[]; created_at: string; }
interface ClaudeConversation { uuid: string; name: string; created_at: string; chat_messages: ClaudeMessage[]; }

const BASE = 'https://claude.ai/api';

// Claude.ai puts message text in `content` blocks; the legacy flat `text` field is often empty
// for newer messages. Prefer text-type content blocks, fall back to any block text, then `text`.
function messageText(m: ClaudeMessage): string {
  if (Array.isArray(m.content)) {
    const typed = m.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text);
    if (typed.length) return typed.map((b) => b.text!).join('\n').trim();
    const anyText = m.content.filter((b) => b && typeof b.text === 'string' && b.text);
    if (anyText.length) return anyText.map((b) => b.text!).join('\n').trim();
  }
  return (m.text ?? '').trim();
}

// A capture is ~90 sequential API reads, so one transient 503/429 (overload, per-user throttle)
// must not kill the whole run. Retry only what can heal — 429 and 5xx, plus thrown network
// errors — with a growing pause; 4xx like 401/404 fail immediately (retrying won't fix auth).
const RETRIES = 3;
const BACKOFF_MS = [1500, 4000, 9000];

export class ClaudeCaptureAdapter implements CaptureAdapter {
  readonly provider = 'claude' as const;
  // Wrap (not bare `fetch`) so the browser's fetch stays bound to its global —
  // calling a detached `fetch` as a method throws "Illegal invocation".
  constructor(
    private orgId: string,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async getWithRetry(url: string, what: string): Promise<Response> {
    let last = '';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await this.sleep(BACKOFF_MS[attempt - 1]);
      let res: Response;
      try {
        res = await this.fetchFn(url, { credentials: 'include' });
      } catch (e) {
        last = String((e as Error)?.message ?? e); // network hiccup — retryable
        continue;
      }
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) throw new Error(`${what} failed: ${res.status}`);
      last = `${what} failed: ${res.status}`;
    }
    throw new Error(`Claude.ai kept returning a temporary error (${last}). Wait a minute and try again — your existing profile was kept.`);
  }

  async listConversations(): Promise<{ id: string; updatedAt: string; model?: string }[]> {
    const res = await this.getWithRetry(`${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations`, 'list');
    const list = (await res.json()) as { uuid: string; updated_at: string; model?: string }[];
    return list.map(c => ({ id: c.uuid, updatedAt: c.updated_at, model: c.model }));
  }

  async fetchConversation(id: string): Promise<RawConversation> {
    const url = `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages`;
    const res = await this.getWithRetry(url, 'fetch');
    const c = (await res.json()) as ClaudeConversation;
    const messages: RawMessage[] = c.chat_messages.map(m => ({
      role: m.sender === 'human' ? 'user' : 'assistant',
      text: messageText(m),
      createdAt: m.created_at,
    }));
    return { id: c.uuid, title: c.name, createdAt: c.created_at, messages };
  }
}
