import type { CaptureAdapter, RawConversation, RawMessage } from './types';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = 'https://chatgpt.com';

interface SessionResp { accessToken?: string }
interface ListItem { id: string; title?: string; create_time?: number | string; update_time?: number | string }
interface ListResp { items?: ListItem[]; total?: number }
interface CGMessage {
  author?: { role?: string };
  create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[] };
}
interface MapNode { id?: string; message?: CGMessage | null; parent?: string | null; children?: string[] }
interface ConvResp { title?: string; create_time?: number | string; current_node?: string; mapping?: Record<string, MapNode> }

// ChatGPT timestamps are unix seconds (floats). Conversation/message order and the
// across-history sampler both compare on ISO strings, so normalize everything to ISO.
function toIso(t: number | string | null | undefined): string {
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString();
  if (typeof t === 'string' && t) {
    const n = Number(t);
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
    const d = Date.parse(t);
    if (Number.isFinite(d)) return new Date(d).toISOString();
  }
  return new Date(0).toISOString();
}

function partsToText(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n').trim();
}

function pickMessage(node: MapNode | undefined): RawMessage | null {
  const m = node?.message;
  const role = m?.author?.role;
  if (role !== 'user' && role !== 'assistant') return null; // skip system/tool
  const text = partsToText(m?.content?.parts);
  if (!text) return null;
  return { role, text, createdAt: toIso(m?.create_time) };
}

// ChatGPT stores messages as a tree in `mapping` (branches for edits/regenerations), and message
// `create_time` is often null — so the reliable order is the active branch: walk parent pointers
// from `current_node` (the live leaf) back to the root, then reverse. Falls back to a create_time
// sort only when current_node is absent. Keeps user/assistant text; drops system/tool/empty.
export function linearizeMapping(mapping: Record<string, MapNode> | undefined, currentNode?: string): RawMessage[] {
  if (!mapping) return [];

  if (currentNode && mapping[currentNode]) {
    const chain: RawMessage[] = [];
    const seen = new Set<string>();
    let id: string | null | undefined = currentNode;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const msg = pickMessage(mapping[id]);
      if (msg) chain.push(msg);
      id = mapping[id].parent;
    }
    return chain.reverse();
  }

  const nodes = Object.values(mapping)
    .filter((n) => n?.message?.author?.role)
    .sort((a, b) => (a.message!.create_time ?? 0) - (b.message!.create_time ?? 0));
  return nodes.map(pickMessage).filter((m): m is RawMessage => m !== null);
}

/**
 * Capture adapter for ChatGPT (chatgpt.com). Mirrors ClaudeCaptureAdapter against ChatGPT's
 * internal backend-api: a bearer access token from /api/auth/session, a paginated conversation
 * list, and a tree-structured conversation detail that we linearize. fetchFn is injectable for tests.
 */
export class ChatGPTCaptureAdapter implements CaptureAdapter {
  readonly provider = 'chatgpt' as const;
  private token: string | null = null;

  constructor(private fetchFn: FetchFn = (url, init) => fetch(url, init)) {}

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await this.fetchFn(`${BASE}/api/auth/session`, { credentials: 'include' });
    if (!res.ok) throw new Error(`ChatGPT session lookup failed: ${res.status}`);
    const j = (await res.json()) as SessionResp;
    if (!j?.accessToken) throw new Error('Not logged into ChatGPT (no access token in session)');
    this.token = j.accessToken;
    return this.token;
  }

  async listConversations(): Promise<{ id: string; updatedAt: string; model?: string }[]> {
    const token = await this.accessToken();
    const headers = { authorization: `Bearer ${token}` };
    const out: { id: string; updatedAt: string; model?: string }[] = [];
    const limit = 100;
    // Paginate (the list endpoint caps each page); stop on a short/empty page, with a safety cap.
    for (let offset = 0; offset <= 1000; offset += limit) {
      const res = await this.fetchFn(`${BASE}/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`, { credentials: 'include', headers });
      if (!res.ok) throw new Error(`ChatGPT list failed: ${res.status}`);
      const j = (await res.json()) as ListResp;
      const items = Array.isArray(j?.items) ? j.items : [];
      for (const it of items) {
        if (!it?.id) continue;
        out.push({ id: it.id, updatedAt: toIso(it.update_time ?? it.create_time) });
      }
      if (items.length < limit) break;
    }
    return out;
  }

  async fetchConversation(id: string): Promise<RawConversation> {
    const token = await this.accessToken();
    const res = await this.fetchFn(`${BASE}/backend-api/conversation/${encodeURIComponent(id)}`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`ChatGPT fetch failed: ${res.status}`);
    const c = (await res.json()) as ConvResp;
    return { id, title: c.title ?? '', createdAt: toIso(c.create_time), messages: linearizeMapping(c.mapping, c.current_node) };
  }
}
