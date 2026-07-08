import type { Provider } from '../store/provider';
import { PROVIDERS, runKey } from '../store/provider';
import { poolKey } from '../engine/evidence-pool';
import { scanKey } from '../store/scanset';

/**
 * Local diagnostic log for beta debugging. NOT telemetry: nothing is ever transmitted — entries
 * live in chrome.storage.local and leave the machine only when the user clicks "Copy diagnostic
 * report" and pastes it somewhere themselves. This keeps the privacy policy's "no analytics,
 * advertising, or tracking code" literally true.
 *
 * PRIVACY IS ENFORCED AT THIS BOUNDARY, not by call-site discipline: detail values are sanitized
 * before storage — chat-ish keys are dropped wholesale, strings are hard-truncated, and nesting
 * is flattened — so even a careless dlog() call cannot park conversation text in the log.
 */

const LOG_KEY = 'aibadges:dlog';
const MAX_ENTRIES = 600;
const MAX_STR = 300; // long enough for an error message, far too short for a transcript

// Any key that could plausibly carry conversation content is dropped entirely.
const FORBIDDEN = /quote|text|prompt|message|content|body|transcript|convo|reply|title|summary|note/i;

export interface DlogEntry { t: string; c: string; e: string; d?: Record<string, unknown> }

export function sanitizeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN.test(k)) continue;
    if (v === undefined) continue; // absent fields stay absent (message objects vary by type)
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…[+${v.length - MAX_STR}]` : v;
    else if (Array.isArray(v)) out[k] = `array(${v.length})`;
    else out[k] = `object(${Object.keys(v as object).length} keys)`; // no nesting — counts only
  }
  return out;
}

// Per-context write queue: serializes read-modify-write so a burst of events in one context
// cannot clobber itself. Cross-context races (content script vs worker) can still drop the odd
// entry; diagnostics are best-effort by design.
let chain: Promise<void> = Promise.resolve();

export function dlog(context: string, event: string, detail?: Record<string, unknown>): void {
  const entry: DlogEntry = { t: new Date().toISOString(), c: context, e: event };
  const d = sanitizeDetail(detail);
  if (d && Object.keys(d).length) entry.d = d;
  chain = chain.then(async () => {
    try {
      const cur = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
      const arr: DlogEntry[] = Array.isArray(cur) ? cur : [];
      arr.push(entry);
      await chrome.storage.local.set({ [LOG_KEY]: arr.slice(-MAX_ENTRIES) });
    } catch { /* diagnostics must never break the product */ }
  });
}

/** Wire uncaught errors/rejections of a context into the log. */
export function captureGlobalErrors(context: string): void {
  try {
    addEventListener('error', (ev) => dlog(context, 'uncaught-error', { err: String((ev as ErrorEvent).message ?? ev) }));
    addEventListener('unhandledrejection', (ev) =>
      dlog(context, 'unhandled-rejection', { err: String((ev as PromiseRejectionEvent).reason?.message ?? (ev as PromiseRejectionEvent).reason) }));
  } catch { /* not every context has addEventListener */ }
}

// Non-sensitive state snapshot: versions, statuses, sizes and flags — never contents.
async function snapshot(): Promise<Record<string, unknown>> {
  const keys: string[] = ['aibadges:cg:running', 'aibadges:chatgpt:autorun-ckpt'];
  for (const p of PROVIDERS as Provider[]) {
    keys.push(`aibadges:latestVersion:${p}`, runKey('status', p), runKey('error', p), poolKey(p), scanKey(p), `aibadges:revealDismissed:${p}`);
  }
  const got = await chrome.storage.local.get(keys);
  const out: Record<string, unknown> = {};
  for (const p of PROVIDERS as Provider[]) {
    let pool = 0; let scanned = 0;
    try { pool = (JSON.parse(String(got[poolKey(p)] ?? '[]')) as unknown[]).length; } catch { /* count stays 0 */ }
    try { scanned = Object.keys((JSON.parse(String(got[scanKey(p)] ?? '{}')) as { entries?: object }).entries ?? {}).length; } catch { /* 0 */ }
    out[p] = {
      profileVersion: Number(got[`aibadges:latestVersion:${p}`] ?? '0'),
      status: got[runKey('status', p)] ?? null,
      lastError: typeof got[runKey('error', p)] === 'string' ? String(got[runKey('error', p)]).slice(0, MAX_STR) : null,
      poolSize: pool, scannedCount: scanned,
      revealDismissed: !!got[`aibadges:revealDismissed:${p}`],
    };
  }
  out.cgRunning = !!got['aibadges:cg:running'];
  let ck: { v?: number; doneBatches?: number[]; skippedBatches?: number[]; totalBatches?: number; startedAt?: string } | null = null;
  try { ck = JSON.parse(String(got['aibadges:chatgpt:autorun-ckpt'] ?? 'null')); } catch { /* absent */ }
  out.checkpoint = ck ? { v: ck.v, total: ck.totalBatches, done: ck.doneBatches, skipped: ck.skippedBatches, startedAt: ck.startedAt } : null;
  return out;
}

/** The pasteable report: environment, state snapshot, and the event log. */
export async function buildDiagnosticReport(): Promise<string> {
  const entries = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] ?? [];
  const report = {
    kind: 'aibadges-diagnostic-report',
    generatedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest?.().version ?? '?',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '?',
    state: await snapshot(),
    log: entries,
  };
  return JSON.stringify(report, null, 1);
}

export async function clearDlog(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY);
}

/** Test hook: resolves when every dlog() issued so far has been persisted. */
export function flushDlog(): Promise<void> {
  return chain.then(() => undefined);
}
