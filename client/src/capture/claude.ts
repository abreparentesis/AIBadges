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

export class ClaudeCaptureAdapter implements CaptureAdapter {
  readonly provider = 'claude' as const;
  // Wrap (not bare `fetch`) so the browser's fetch stays bound to its global —
  // calling a detached `fetch` as a method throws "Illegal invocation".
  constructor(private orgId: string, private fetchFn: FetchFn = (url, init) => fetch(url, init)) {}

  async listConversations(): Promise<{ id: string; updatedAt: string; model?: string }[]> {
    const res = await this.fetchFn(`${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations`, { credentials: 'include' });
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    const list = (await res.json()) as { uuid: string; updated_at: string; model?: string }[];
    return list.map(c => ({ id: c.uuid, updatedAt: c.updated_at, model: c.model }));
  }

  async fetchConversation(id: string): Promise<RawConversation> {
    const url = `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages`;
    const res = await this.fetchFn(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const c = (await res.json()) as ClaudeConversation;
    const messages: RawMessage[] = c.chat_messages.map(m => ({
      role: m.sender === 'human' ? 'user' : 'assistant',
      text: messageText(m),
      createdAt: m.created_at,
    }));
    return { id: c.uuid, title: c.name, createdAt: c.created_at, messages };
  }
}
