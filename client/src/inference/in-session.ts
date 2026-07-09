import type { ModelCaller } from './types';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface ClaudeContentBlock { type?: string; text?: string }
interface ClaudeConversationMessage { sender?: string; text?: string; content?: ClaudeContentBlock[] }

const BASE = 'https://claude.ai/api';
const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';
const DEFAULT_TIMEOUT_MS = 75000;
const MAX_ATTEMPTS = 4;
// Transient, worth backing off and retrying: 429 (rate limited) and 529 (overloaded).
const RETRYABLE = new Set([429, 529]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Raised when the in-session API rejects with a usage cap that won't clear by waiting
// (e.g. the account's weekly/7-day limit). Distinct from a transient 429, which we just
// back off and retry. Carries the reset time so the UI can tell the user when to come back.
export class RateLimitError extends Error {
  readonly rateLimit = true;
  constructor(message: string, readonly resetsAt: number | null, readonly windowKey: string | null) {
    super(message);
    this.name = 'RateLimitError';
  }
}
export function isRateLimitError(e: unknown): e is RateLimitError {
  return !!e && typeof e === 'object' && (e as { rateLimit?: boolean }).rateLimit === true;
}

// Raised when the user pressed Stop: the run must end quickly and quietly (no error state,
// no retries). Carries a flag rather than relying on the AbortError name, which varies.
export class CancelledError extends Error {
  readonly cancelled = true;
  constructor() { super('Run cancelled by the user.'); this.name = 'CancelledError'; }
}
export function isCancelledError(e: unknown): e is CancelledError {
  return !!e && typeof e === 'object' && (e as { cancelled?: boolean }).cancelled === true;
}

// Claude.ai wraps the limit detail as a JSON string inside error.message. A window with
// status "exceeded_limit" means a real cap (hours/days away), not a momentary throttle.
function classifyLimit(bodyText: string): { exceeded: boolean; resetsAt: number | null; windowKey: string | null } {
  try {
    const outer = JSON.parse(bodyText);
    const inner = JSON.parse(outer?.error?.message ?? '{}');
    const windows = inner?.windows ?? {};
    for (const [k, w] of Object.entries(windows)) {
      if ((w as { status?: string })?.status === 'exceeded_limit') {
        return { exceeded: true, resetsAt: (w as { resets_at?: number }).resets_at ?? inner.resetsAt ?? null, windowKey: k };
      }
    }
    return { exceeded: false, resetsAt: inner.resetsAt ?? null, windowKey: inner.representativeClaim ?? null };
  } catch {
    return { exceeded: false, resetsAt: null, windowKey: null };
  }
}

// Honor Retry-After when the server sends it (seconds), else exponential backoff
// with jitter. Capped so a single throttled call can't stall the run indefinitely.
function backoffMs(res: Response | null, attempt: number, baseMs: number): number {
  const ra = Number(res?.headers?.get?.('retry-after'));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30000);
  const exp = Math.min(baseMs * 2 ** (attempt - 1), 30000);
  return exp + Math.floor((exp / 4) * Math.random());
}

export function extractTextFromSse(sse: string): string {
  let text = '';
  // Claude.ai has used both a legacy `completion` stream and the newer Messages API
  // `content_block_delta` stream. A response should use one format, but lock onto the
  // first text family we see so a transitional stream cannot duplicate its output.
  let format: 'completion' | 'content_block_delta' | null = null;
  for (const line of sse.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      if (evt?.type === 'completion' && typeof evt.completion === 'string' && format !== 'content_block_delta') {
        format = 'completion';
        text += evt.completion;
      } else if (evt?.type === 'content_block_delta' && evt?.delta?.type === 'text_delta' && format !== 'completion') {
        format = 'content_block_delta';
        text += evt.delta.text ?? '';
      }
    } catch { /* keepalive / non-JSON */ }
  }
  return text;
}

function assistantMessageText(body: unknown): string {
  const messages = (body as { chat_messages?: unknown })?.chat_messages;
  if (!Array.isArray(messages)) return '';
  const message = [...messages].reverse().find((m): m is ClaudeConversationMessage =>
    !!m && typeof m === 'object' && (m as ClaudeConversationMessage).sender === 'assistant',
  );
  if (!message) return '';
  const blocks = Array.isArray(message.content) ? message.content : [];
  const blockText = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  return blockText || message.text || '';
}

/**
 * Runs profiling prompts in the user's own Claude.ai session. Each call creates a labeled scratch
 * conversation, streams the completion, and deletes it. Every call is bounded by a timeout via
 * AbortController — a stalled/throttled completion aborts (and is cleaned up) instead of hanging the
 * whole run forever. A caller may pin a known-valid model, but callers should otherwise let
 * Claude.ai select the account's current default rather than replaying model ids from history.
 */
export class InSessionClaudeCaller implements ModelCaller {
  private scratchIds = new Set<string>();
  private active = new Set<AbortController>();
  private aborted = false;

  constructor(
    private orgId: string,
    private model: string | null = null,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
    private retryBaseMs = 5000,
  ) {}

  /** Stop button: abort every in-flight call and refuse new ones. Scratch cleanup still runs. */
  abortAll(): void {
    this.aborted = true;
    for (const c of [...this.active]) c.abort();
  }

  async complete(prompt: string, opts?: { system?: string; model?: string; timeoutMs?: number }): Promise<string> {
    // Conversation metadata describes models used in the past, not models this account is allowed
    // to start today. Sending those stale ids causes Claude.ai to reject every completion with 403.
    const model = this.model;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastStatus = 0;
    // In-session completions are rate-limited (429) and occasionally overloaded (529),
    // especially when the pipeline fires several in quick succession. Back off and retry
    // those instead of degrading the calling lens to its floor. Non-retryable failures
    // throw immediately; parse-level problems are handled by the caller (the lens).
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.aborted) throw new CancelledError();
      let r: Awaited<ReturnType<InSessionClaudeCaller['attemptOnce']>>;
      try {
        r = await this.attemptOnce(prompt, model, timeoutMs);
      } catch (e) {
        if (this.aborted) throw new CancelledError(); // fetch abort surfaced as a rejection
        throw e;
      }
      if (r.ok) return r.text;
      lastStatus = r.status;
      if (r.status === 429) {
        // A real usage cap (e.g. the weekly limit) won't clear by waiting seconds — fail fast
        // with the reset time so the UI can say so. Only a transient 429 is worth a backoff.
        const lim = classifyLimit(r.body);
        if (lim.exceeded) {
          throw new RateLimitError(`Claude ${lim.windowKey ?? 'usage'} limit reached`, lim.resetsAt, lim.windowKey);
        }
      }
      if (!RETRYABLE.has(r.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(`${r.phase} failed: ${r.status}`);
      }
      await sleep(backoffMs(r.res, attempt, this.retryBaseMs));
    }
    throw new Error(`completion failed after ${MAX_ATTEMPTS} attempts: ${lastStatus}`);
  }

  // One create → completion → delete cycle. Cleanup and the abort timer are scoped here so
  // the retry loop in complete() stays linear. Returns the text or the failing HTTP status+body.
  private async attemptOnce(
    prompt: string, model: string | null, timeoutMs: number,
  ): Promise<{ ok: true; text: string } | { ok: false; status: number; phase: string; res: Response; body: string }> {
    const convId = globalThis.crypto.randomUUID();
    this.scratchIds.add(convId);
    const ctrl = new AbortController();
    this.active.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const createRes = await this.fetchFn(
        `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations`,
        { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          signal: ctrl.signal, body: JSON.stringify({ uuid: convId, name: 'AI Fluency Index analysis (safe to delete)' }) },
      );
      if (!createRes.ok) {
        return { ok: false, status: createRes.status, phase: 'scratch conversation create', res: createRes, body: await createRes.text().catch(() => '') };
      }

      const compRes = await this.fetchFn(
        `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations/${convId}/completion`,
        { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            prompt, parent_message_uuid: ROOT_PARENT,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(model ? { model } : {}),
            rendering_mode: 'messages',
          }) },
      );
      if (!compRes.ok) return { ok: false, status: compRes.status, phase: 'completion', res: compRes, body: await compRes.text().catch(() => '') };
      const streamed = extractTextFromSse(await compRes.text());
      if (streamed.trim()) return { ok: true, text: streamed };

      // Claude.ai's private endpoint has changed its SSE envelope more than once. The completed
      // message is also persisted to the scratch conversation, which is a stable fallback when
      // an unfamiliar envelope carries no extractable text.
      try {
        const messageRes = await this.fetchFn(
          `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations/${convId}?tree=True&rendering_mode=messages`,
          { credentials: 'include', signal: ctrl.signal },
        );
        if (messageRes.ok) {
          const saved = assistantMessageText(await messageRes.json());
          if (saved.trim()) return { ok: true, text: saved };
        }
      } catch { /* the stream result remains authoritative when this best-effort fallback fails */ }
      return { ok: true, text: streamed };
    } finally {
      clearTimeout(timer);
      this.active.delete(ctrl);
      await this.deleteConversation(convId);
      this.scratchIds.delete(convId);
    }
  }

  async dispose(): Promise<void> {
    for (const id of [...this.scratchIds]) { await this.deleteConversation(id); this.scratchIds.delete(id); }
  }

  private async deleteConversation(convId: string): Promise<void> {
    try {
      await this.fetchFn(
        `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations/${convId}`,
        { method: 'DELETE', credentials: 'include' },
      );
    } catch { /* best-effort cleanup */ }
  }
}
