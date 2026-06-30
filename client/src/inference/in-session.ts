import type { ModelCaller } from './types';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

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
  for (const line of sse.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload);
      if (evt?.type === 'content_block_delta' && evt?.delta?.type === 'text_delta') text += evt.delta.text ?? '';
    } catch { /* keepalive / non-JSON */ }
  }
  return text;
}

/**
 * Runs profiling prompts in the user's own Claude.ai session. Each call creates a labeled scratch
 * conversation, streams the completion, and deletes it. Every call is bounded by a timeout via
 * AbortController — a stalled/throttled completion aborts (and is cleaned up) instead of hanging the
 * whole run forever. Model is chosen per call (fast for bulk extraction, best for synthesis).
 */
export class InSessionClaudeCaller implements ModelCaller {
  private scratchIds = new Set<string>();

  constructor(
    private orgId: string,
    private model: string | null = null,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
    private retryBaseMs = 5000,
  ) {}

  async complete(prompt: string, opts?: { system?: string; model?: string; timeoutMs?: number }): Promise<string> {
    const model = opts?.model ?? this.model;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastStatus = 0;
    // In-session completions are rate-limited (429) and occasionally overloaded (529),
    // especially when the pipeline fires several in quick succession. Back off and retry
    // those instead of degrading the calling lens to its floor. Non-retryable failures
    // throw immediately; parse-level problems are handled by the caller (the lens).
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const r = await this.attemptOnce(prompt, model, timeoutMs);
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
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const createRes = await this.fetchFn(
        `${BASE}/organizations/${encodeURIComponent(this.orgId)}/chat_conversations`,
        { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          signal: ctrl.signal, body: JSON.stringify({ uuid: convId, name: 'AIBadges analysis (safe to delete)' }) },
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
      return { ok: true, text: extractTextFromSse(await compRes.text()) };
    } finally {
      clearTimeout(timer);
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
