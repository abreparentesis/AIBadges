import { ChatGPTCaptureAdapter } from './chatgpt';
import { selectAcrossTimeline } from './select';
import { buildChatGptExport } from './chatgpt-export';
import { buildExtractionPrompt, buildSynthesisFromEvidence, buildAuditPrompt } from './chatgpt-prompt';
import { setComposer, clickSend, hasChallenge } from './chatgpt-bridge';
import { importGptReply, CAPTURE_KEY } from '../run/import-chatgpt';
import { CG_BATCH_OUT_PREFIX, CG_BATCH_CONVO_PREFIX, batchOutKey, batchConvoKey } from './cg-keys';
import type { RawConversation } from './types';
import type { CaptureBundle } from './chatgpt-export';

// Fully invisible ChatGPT run inside (background) chatgpt.com tabs: capture history, run the
// analysis in throwaway conversations, read the replies from the backend API (which works even when
// a tab is hidden, unlike the DOM which does not render while backgrounded), delete the
// conversations, and import. Nothing is left in the user's ChatGPT history, mirroring how the
// Claude path uses a scratch conversation it deletes. The only DOM coupling is the submit
// (fill + send), which each tab does in its own composer.
//
// PARALLEL EXTRACTION: the extraction prompt is self-contained (each batch carries its own INPUT
// and the pooled evidence is re-injected into synthesis client-side), so extraction batches don't
// need to share a conversation. The orchestrator tab — the one the service worker opened with the
// autorun flag — asks the service worker to spawn up to EXTRACT_TAB_CONCURRENCY background worker
// tabs, each running ONE batch in its own throwaway conversation (runExtractionBatch), writing its
// evidence units to storage, deleting its conversation, and closing. Synthesis and audit then run
// sequentially in ONE conversation in the orchestrator tab (the audit references the synthesis
// in-conversation, so they cannot be split).
//
// RELIABILITY MODEL (added after real-world mid-flight failures): the run is many model turns, so
// it must survive any single turn dying. Every completed batch is checkpointed per-batch to
// chrome.storage.local (completion can be out of order); a re-run resumes from the checkpoint in
// FRESH throwaway conversations. Long turns emit a heartbeat so the service worker's watchdog
// knows the run is alive; reply waits are step-aware and only time out after a minimum number of
// REAL polls, because hidden-tab timers are throttled to as little as one tick per minute.

type Notify = (m: Record<string, unknown>) => void;

const BASE = 'https://chatgpt.com';
const TOTAL_CONVOS = 90;           // three extraction batches; affordable again because they run in
                                   // parallel worker tabs, so 90 costs the same wall-clock as the
                                   // old sequential 60 (ceil(3/2) waves at concurrency 2)
const BATCH_SIZE = 30;             // conversations per extraction turn (map step): small enough that one
                                   // batch's evidence reply won't hit the model's output limit and truncate
// Parallel background worker tabs for the extraction batches. 2 is the sweet spot; hard cap 3 —
// more simultaneous hidden conversations risks rate limits and login challenges.
export const EXTRACT_TAB_CONCURRENCY = 2;
const MAX_EXTRACT_TABS = 3;
const PER_CONVO_CHARS = 2500;      // user-centric capture packs a chat into far less than the old 4000
const ASSISTANT_HEAD_CHARS = 160;  // keep only a short head of each AI turn — enough to judge a reaction

export const CKPT_KEY = 'aibadges:chatgpt:autorun-ckpt';
const CKPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Step-aware reply deadlines. Synthesis/audit reason over the whole evidence pool and routinely run
// past three minutes; extraction batches are smaller. Both far exceed the old flat 180s that caused
// real timeouts.
const EXTRACT_TIMEOUT_MS = 240_000;
const REDUCE_TIMEOUT_MS = 420_000;
const MIN_POLLS = 8; // a timeout only counts after this many actual polls (hidden-tab timer throttling)
// How long the orchestrator waits for one worker tab's result before writing the batch off. A
// worker's own budget is 2 attempts x (reply wait + conversation binding), and hidden-tab timer
// throttling can stretch its MIN_POLLS gate to ~1 poll/minute — so this is generous on purpose;
// it only fires for a tab that is truly dead (crashed, or redirected where our script never runs).
const BATCH_TAB_DEADLINE_MS = 20 * 60_000;
const BATCH_POLL_MS = 2000;

async function accessToken(): Promise<string> {
  const s = await fetch(`${BASE}/api/auth/session`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
  if (!s?.accessToken) throw new Error('Not logged into ChatGPT (open chatgpt.com and sign in).');
  return s.accessToken as string;
}

interface CGNode { message?: { author?: { role?: string }; status?: string; content?: { parts?: unknown[] } }; parent?: string | null }

function conversationId(): string | null {
  const m = location.pathname.match(/\/c\/([0-9a-f-]+)/i);
  return m ? m[1] : null;
}

async function topConversationId(token: string): Promise<string | null> {
  try {
    const j = await fetch(`${BASE}/backend-api/conversations?offset=0&limit=1&order=updated`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null));
    return j?.items?.[0]?.id ?? null;
  } catch { return null; }
}

// Does this conversation contain a user message that ends with our prompt's tail? Used to verify
// that a fallback-bound conversation is really OURS: with several worker tabs creating throwaway
// conversations at once (and the user possibly chatting in a foreground tab), "most recently
// updated" alone could bind to — and later delete — someone else's conversation. The tail of the
// prompt is distinct per batch (it ends in that batch's INPUT JSON / evidence pool).
function mappingHasUserText(mapping: Record<string, CGNode>, tail: string): boolean {
  for (const n of Object.values(mapping)) {
    const m = n?.message;
    if (m?.author?.role !== 'user') continue;
    const text = ((m.content?.parts ?? []).filter((p): p is string => typeof p === 'string').join('')).trim();
    if (text.endsWith(tail)) return true;
  }
  return false;
}

async function conversationMatchesPrompt(id: string, token: string, prompt: string): Promise<boolean> {
  const tail = prompt.trim().slice(-300);
  for (let i = 0; i < 2; i++) {
    const c = await fetch(`${BASE}/backend-api/conversation/${encodeURIComponent(id)}`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (c?.mapping && mappingHasUserText(c.mapping as Record<string, CGNode>, tail)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// After a submit, ChatGPT navigates from "/" to "/c/{id}" a beat later (once the response starts), so
// the id is not there immediately. Poll the URL until it appears. Fallback (SPA route lagging in a
// throttled tab): take the most-recently-updated conversation — but ONLY if it is NEW since the run
// started (differs from preTopId) AND actually contains our own prompt (a sibling worker tab or the
// user could have created the newest conversation). Otherwise fail loudly instead of binding to,
// and later deleting, a conversation that isn't ours.
async function awaitConversationId(
  token: string, preTopId: string | null, ownPrompt: string, timeoutMs = 45000, everyMs = 800,
): Promise<string | null> {
  const start = Date.now();
  let id = conversationId();
  while (!id && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, everyMs));
    id = conversationId();
  }
  if (id) return id;
  const top = await topConversationId(token);
  if (!top || top === preTopId) return null;
  return (await conversationMatchesPrompt(top, token, ownPrompt)) ? top : null;
}

// Fill the composer and click ChatGPT's own send button, retrying while React enables the button
// (and, in a freshly spawned worker tab, while the composer is still mounting). A visible challenge
// means we cannot submit unattended, so surface it rather than hang.
async function submitPrompt(prompt: string, tries = 40, everyMs = 500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (hasChallenge()) throw new Error('ChatGPT is showing a verification step. Open chatgpt.com, then run again.');
    if (setComposer(prompt) && clickSend()) return;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error('Could not submit the analysis prompt to ChatGPT.');
}

// Walk from the conversation's current_node (the live leaf) up to the nearest assistant message, so we
// read the LATEST reply regardless of the mapping's key order. Returns its text, status, and node id.
function replyAtCurrentNode(mapping: Record<string, CGNode>, currentNode: string | undefined):
  { text: string; status: string; node: string } | null {
  let id: string | null | undefined = currentNode;
  const seen = new Set<string>();
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    const m = mapping[id].message;
    if (m?.author?.role === 'assistant') {
      const text = ((m.content?.parts ?? []).filter((p): p is string => typeof p === 'string').join('')).trim();
      return { text, status: m.status ?? '', node: id };
    }
    id = mapping[id].parent;
  }
  return null;
}

// Pure decision for the reply wait, extracted for tests. 'accept' only on a server-confirmed
// finished reply. Past the deadline we still require MIN real polls (throttled hidden tabs tick
// rarely, and wall-clock alone would declare phantom timeouts), and a partial reply is accepted
// only when its text has been stable across several polls — never import a mid-stream reply.
export interface ReplyPoll {
  finished: boolean;    // server marked the reply finished_successfully
  hasText: boolean;
  stablePolls: number;  // consecutive polls with unchanged text
  polls: number;        // actual polls performed
  elapsedMs: number;
}
export function replyWaitDecision(
  s: ReplyPoll,
  o: { timeoutMs: number; minPolls: number },
): 'wait' | 'accept' | 'accept-partial' | 'timeout' {
  if (s.finished && s.hasText) return 'accept';
  if (s.elapsedMs > o.timeoutMs && s.polls >= o.minPolls) {
    return s.hasText && s.stablePolls >= 3 ? 'accept-partial' : 'timeout';
  }
  return 'wait';
}

// Poll the conversation over the API until the latest assistant reply is finished, then return it.
// Independent of DOM rendering, so it completes while the tab is backgrounded. excludeNode lets the
// caller wait for a NEW reply — the second message must not return the first message's finished
// reply. Emits a heartbeat every poll so the service worker's watchdog knows the run is alive
// during multi-minute turns (its silence budget is far shorter than a synthesis turn).
async function awaitReply(
  id: string, token: string, notify: Notify, excludeNode: string | undefined, timeoutMs: number,
  everyMs = 1500,
): Promise<{ text: string; node: string }> {
  const start = Date.now();
  let latest = { text: '', node: '' };
  let stablePolls = 0;
  let polls = 0;
  let finished = false;
  for (;;) {
    await new Promise((r) => setTimeout(r, everyMs));
    polls++;
    notify({ type: 'aibadges:cg-heartbeat' });
    const c = await fetch(`${BASE}/backend-api/conversation/${encodeURIComponent(id)}`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (c?.mapping) {
      const r = replyAtCurrentNode(c.mapping as Record<string, CGNode>, c.current_node);
      if (r && !(excludeNode && r.node === excludeNode)) {
        if (r.text === latest.text && r.text) stablePolls++;
        else { stablePolls = 0; if (r.text) latest = { text: r.text, node: r.node }; }
        finished = r.status === 'finished_successfully' && !!r.text;
      }
    }
    const decision = replyWaitDecision(
      { finished, hasText: !!latest.text, stablePolls, polls, elapsedMs: Date.now() - start },
      { timeoutMs, minPolls: MIN_POLLS },
    );
    if (decision === 'accept' || decision === 'accept-partial') return latest;
    if (decision === 'timeout') throw new Error('Timed out waiting for the ChatGPT reply.');
  }
}

async function deleteConversation(id: string, token: string): Promise<void> {
  await fetch(`${BASE}/backend-api/conversation/${encodeURIComponent(id)}`, {
    method: 'PATCH', credentials: 'include',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ is_visible: false }),
  }).catch(() => { /* best-effort cleanup */ });
}

// One model turn with a single retry, parameterized per conversation so the orchestrator tab
// (synthesis + audit in one conversation) and each extraction worker tab (one batch in its own
// conversation) share the exact same submit → bind → reply-wait pattern. The first turn binds the
// conversation id and reports it via onBound (checkpointing for later cleanup).
interface TurnCtx {
  token: string;
  preTopId: string | null;
  id: string | null;
  lastNode?: string;
  onBound?: (id: string) => Promise<void> | void;
}
async function runTurnIn(ctx: TurnCtx, prompt: string, timeoutMs: number, notify: Notify): Promise<{ text: string; node: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      await submitPrompt(prompt);
      if (!ctx.id) {
        ctx.id = await awaitConversationId(ctx.token, ctx.preTopId, prompt);
        if (!ctx.id) throw new Error('ChatGPT did not start a conversation.');
        await ctx.onBound?.(ctx.id);
      }
      const reply = await awaitReply(ctx.id, ctx.token, notify, ctx.lastNode, timeoutMs);
      ctx.lastNode = reply.node;
      return reply;
    } catch (e) {
      if (attempt >= 2) throw e;
      notify({ type: 'aibadges:cg-heartbeat' });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ---- batched map-reduce helpers ----
export type RawUnit = { conversationId: string; quote: string; summary: string; type: string };
type PooledUnit = RawUnit & { id: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Tolerant fenced/loose JSON extraction (mirrors the importer's parsing).
function parseJsonBlock(raw: string): unknown {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : raw).trim();
  const m = body.match(/[[{][\s\S]*[\]}]/);
  return JSON.parse((m ? m[0] : body).replace(/,(\s*[}\]])/g, '$1'));
}

// Pull the evidence units out of one extraction reply ({"evidence":[...]} or a bare array). The
// model's own ids are dropped — the pool assembly assigns globally-unique ids across batches so
// citations stay stable regardless of how each batch numbered its units.
export function parseEvidence(reply: string): RawUnit[] {
  let arr: unknown[] = [];
  try {
    const e = parseJsonBlock(reply);
    if (Array.isArray(e)) arr = e;
    else if (e && typeof e === 'object' && Array.isArray((e as { evidence?: unknown[] }).evidence)) arr = (e as { evidence: unknown[] }).evidence;
  } catch { return []; }
  const out: RawUnit[] = [];
  for (const u of arr) {
    const o = u as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || typeof o.quote !== 'string' || !o.quote) continue;
    const conversationId = String(o.conversationId ?? o.conversation_id ?? '');
    if (!conversationId) continue; // un-attributed: can't be dated, and would collapse into one 'unknown' bucket
    out.push({
      conversationId,
      quote: o.quote,
      summary: typeof o.summary === 'string' ? o.summary : '',
      type: typeof o.type === 'string' ? o.type : 'episode',
    });
  }
  return out;
}

// Flatten the per-batch units into the single id-stable pool the synthesis prompt embeds. Ids are
// assigned in BATCH-INDEX order (not completion order), so parallel out-of-order completion and a
// resumed run always produce the same e1..eN numbering for the same set of completed batches.
export function assemblePool(unitsByBatch: Record<string, RawUnit[]>, doneBatches: number[]): PooledUnit[] {
  const pooled: PooledUnit[] = [];
  for (const b of [...doneBatches].sort((a, z) => a - z)) {
    for (const u of unitsByBatch[b] ?? []) pooled.push({ ...u, id: `e${pooled.length + 1}` });
  }
  return pooled;
}

// Assemble the object the importer expects: the client-owned pooled evidence, the profile from
// synthesis, and the AUDITED capability (re-judged bands + surviving ids) replacing synthesis's draft
// aiFluency/domains. Any unparseable model reply falls back so a partial run still imports.
const FLUENCY_KEYS = ['delegation', 'description', 'discernment', 'diligence'] as const;

export function combineForImport(pooled: PooledUnit[], synthReply: string, auditReply: string): string {
  let synth: Record<string, unknown> = {};
  try {
    const p = parseJsonBlock(synthReply);
    if (p && typeof p === 'object' && !Array.isArray(p)) synth = p as Record<string, unknown>;
  } catch { /* leave empty */ }
  try {
    const a = parseJsonBlock(auditReply) as { aiFluency?: Record<string, unknown>; domains?: unknown };
    const flu = a?.aiFluency;
    // Only accept the audited capability if it re-bands ALL FOUR dimensions. A partial reply
    // (e.g. {"aiFluency":{}}) would leave the missing dimensions undefined and the importer would
    // default them to `emerging`, silently collapsing a real profile. On a partial/missing audit,
    // keep the synthesis draft (matching the Claude path's schema guard).
    const complete = flu && typeof flu === 'object' && FLUENCY_KEYS.every((k) => flu[k] && typeof flu[k] === 'object');
    if (complete) {
      const draftCap = (synth.capability && typeof synth.capability === 'object') ? synth.capability as Record<string, unknown> : {};
      synth.capability = { ...draftCap, aiFluency: flu, ...(a.domains ? { domains: a.domains } : {}) };
    }
  } catch { /* audit unreadable — keep the synthesis capability */ }
  return JSON.stringify({ ...synth, evidence: pooled });
}

// ---- checkpoint / resume ----

export interface AutorunCheckpoint {
  v: 2;
  startedAt: string;        // ISO; a checkpoint older than CKPT_MAX_AGE_MS is discarded
  totalBatches: number;     // to detect a capture-shape mismatch (then the checkpoint is unusable)
  doneBatches: number[];    // batch indices whose evidence was extracted (completion may be out of order)
  skippedBatches: number[]; // batches that failed all retries and were skipped (coverage note)
  unitsByBatch: Record<string, RawUnit[]>; // per-batch raw units; ids are assigned at assembly time
  synthText?: string;       // present once synthesis completed
  convoId?: string;         // the orchestrator's throwaway (synthesis/audit); deleted on resume
}

export interface RunPlan {
  resume: boolean;
  doneBatches: number[];
  skippedBatches: number[];
  unitsByBatch: Record<string, RawUnit[]>;
  synthText?: string;
  staleConvoId?: string;
}

const fresh = (staleConvoId?: string): RunPlan => ({
  resume: false, doneBatches: [], skippedBatches: [], unitsByBatch: {},
  ...(staleConvoId ? { staleConvoId } : {}),
});

// Decide what a run can reuse from a prior interrupted run. Pure, for tests. A stale,
// shape-mismatched, or legacy (v1, count-based) checkpoint yields a fresh plan but still surfaces
// the old throwaway conversation id so it can be cleaned up.
export function planRun(raw: unknown, totalBatches: number, nowMs: number, maxAgeMs = CKPT_MAX_AGE_MS): RunPlan {
  const c = raw as AutorunCheckpoint | null | undefined;
  if (!c || typeof c !== 'object') return fresh();
  const staleId = typeof c.convoId === 'string' && c.convoId ? c.convoId : undefined;
  if (c.v !== 2 || !Array.isArray(c.doneBatches) || !c.unitsByBatch || typeof c.unitsByBatch !== 'object') return fresh(staleId);
  const stale = !c.startedAt || nowMs - Date.parse(c.startedAt) > maxAgeMs;
  if (stale || c.totalBatches !== totalBatches) return fresh(staleId);
  const inRange = (b: unknown): b is number => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < totalBatches;
  const doneBatches = [...new Set(c.doneBatches.filter(inRange))];
  const skippedBatches = [...new Set((Array.isArray(c.skippedBatches) ? c.skippedBatches : []).filter(inRange))]
    .filter((b) => !doneBatches.includes(b));
  return {
    resume: doneBatches.length > 0 || skippedBatches.length > 0 || !!c.synthText,
    doneBatches,
    skippedBatches,
    unitsByBatch: c.unitsByBatch,
    synthText: typeof c.synthText === 'string' && c.synthText ? c.synthText : undefined,
    staleConvoId: staleId,
  };
}

async function saveCkpt(c: AutorunCheckpoint): Promise<void> {
  await chrome.storage.local.set({ [CKPT_KEY]: JSON.stringify(c) }).catch?.(() => { /* best effort */ });
}
export async function clearCkpt(): Promise<void> {
  await chrome.storage.local.remove(CKPT_KEY);
}
async function loadCkpt(): Promise<unknown> {
  const raw = (await chrome.storage.local.get(CKPT_KEY))[CKPT_KEY];
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---- extraction worker (runs in ITS OWN background tab, one batch per tab) ----

// Run one extraction batch in this tab's own throwaway conversation and hand the result to the
// orchestrator through storage (content scripts can't message each other directly). Never throws:
// a batch that fails all retries writes { failed: true } so the orchestrator can skip it without
// killing the run. The scratch conversation is deleted on every path, and its id is checkpointed
// to storage the moment it binds so even a crashed tab's conversation gets cleaned up next run.
export async function runExtractionBatch(batch: number, notify: Notify): Promise<void> {
  const write = (out: { units?: RawUnit[]; failed?: true }) =>
    chrome.storage.local.set({ [batchOutKey(batch)]: JSON.stringify(out) });
  const ctx: TurnCtx = { token: '', preTopId: null, id: null };
  try {
    const stored = (await chrome.storage.local.get(CAPTURE_KEY))[CAPTURE_KEY];
    if (typeof stored !== 'string' || !stored) throw new Error('No capture bundle for the extraction batch.');
    const bundle = JSON.parse(stored) as CaptureBundle;
    const convos = chunk(bundle.export.conversations, BATCH_SIZE)[batch];
    if (!convos?.length) throw new Error('Extraction batch out of range.');
    const subBundle = { export: { ...bundle.export, conversations: convos }, idMap: bundle.idMap, capturedAt: bundle.capturedAt };
    ctx.token = await accessToken();
    ctx.preTopId = await topConversationId(ctx.token);
    ctx.onBound = (id) => chrome.storage.local.set({ [batchConvoKey(batch)]: id });
    const reply = await runTurnIn(ctx, buildExtractionPrompt(subBundle), EXTRACT_TIMEOUT_MS, notify);
    await write({ units: parseEvidence(reply.text) });
  } catch (e) {
    console.error('[aibadges] chatgpt extraction batch failed', batch, e);
    await write({ failed: true });
  } finally {
    if (ctx.id && ctx.token) await deleteConversation(ctx.id, ctx.token);
    await chrome.storage.local.remove(batchConvoKey(batch)).catch?.(() => { /* best effort */ });
  }
}

// ---- orchestrator-side parallel batch driver ----

// Delete leftovers of a prior interrupted run's workers: stray scratch conversations (recorded via
// batchConvoKey by workers that died before their own cleanup) and stale result payloads.
async function cleanupBatchLeftovers(token: string): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CG_BATCH_OUT_PREFIX) || k.startsWith(CG_BATCH_CONVO_PREFIX));
  for (const k of keys) {
    const v = all[k];
    if (k.startsWith(CG_BATCH_CONVO_PREFIX) && typeof v === 'string' && v) await deleteConversation(v, token);
  }
  if (keys.length) await chrome.storage.local.remove(keys);
}

// Fan the remaining batches out over background worker tabs, at most EXTRACT_TAB_CONCURRENCY at a
// time. The service worker owns tab lifecycle (spawn on 'aibadges:cg-spawn-batch', close on the
// worker's 'aibadges:cg-batch-tab-done' or our 'aibadges:cg-kill-batch'); results come back through
// storage. The poll loop doubles as this tab's heartbeat source so the watchdog stays fed while
// only worker tabs are doing model work. onDone fires once per batch — units on success (possibly
// empty), null when the batch failed all retries or its tab went dark past the deadline.
async function runBatchesInTabs(
  remaining: number[], notify: Notify,
  onDone: (batch: number, units: RawUnit[] | null) => Promise<void>,
): Promise<void> {
  const queue = [...remaining].sort((a, z) => a - z);
  const inFlight = new Map<number, number>(); // batch -> spawnedAt (ms)
  const concurrency = Math.min(Math.max(1, EXTRACT_TAB_CONCURRENCY), MAX_EXTRACT_TABS);
  const spawn = (batch: number) => new Promise<void>((res) => {
    inFlight.set(batch, Date.now());
    chrome.runtime.sendMessage({ type: 'aibadges:cg-spawn-batch', batch }, () => { void chrome.runtime.lastError; res(); });
  });
  while (queue.length && inFlight.size < concurrency) await spawn(queue.shift()!);
  while (inFlight.size) {
    await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
    notify({ type: 'aibadges:cg-heartbeat' });
    const got = await chrome.storage.local.get([...inFlight.keys()].map(batchOutKey));
    for (const [batch, spawnedAt] of [...inFlight]) {
      const raw = got[batchOutKey(batch)];
      if (typeof raw === 'string' && raw) {
        inFlight.delete(batch);
        await chrome.storage.local.remove(batchOutKey(batch));
        let units: RawUnit[] | null = null;
        try {
          const out = JSON.parse(raw) as { units?: RawUnit[]; failed?: boolean };
          units = Array.isArray(out.units) ? out.units : null;
        } catch { units = null; }
        await onDone(batch, units);
      } else if (Date.now() - spawnedAt > BATCH_TAB_DEADLINE_MS) {
        // The tab never reported back — dead or unreachable. Ask the service worker to close it
        // and move on; its scratch conversation (if any) is cleaned up from batchConvoKey next run.
        inFlight.delete(batch);
        chrome.runtime.sendMessage({ type: 'aibadges:cg-kill-batch', batch }, () => void chrome.runtime.lastError);
        await onDone(batch, null);
      }
    }
    while (queue.length && inFlight.size < concurrency) await spawn(queue.shift()!);
  }
}

export async function runAutoProfile(notify: Notify): Promise<void> {
  // 0. A prior interrupted run leaves a checkpoint + the capture bundle; reuse both so resume
  //    skips completed work AND analyses the exact same batches (a re-capture could re-shuffle
  //    conversations and misalign the checkpoint).
  const ckptRaw = await loadCkpt();
  let bundle: CaptureBundle | null = null;
  if (ckptRaw) {
    const stored = (await chrome.storage.local.get(CAPTURE_KEY))[CAPTURE_KEY];
    if (typeof stored === 'string' && stored) { try { bundle = JSON.parse(stored) as CaptureBundle; } catch { bundle = null; } }
  }

  // 1. Capture history (read-only, user-centric) across the whole timeline — unless resuming.
  if (!bundle) {
    const adapter = new ChatGPTCaptureAdapter();
    const list = await adapter.listConversations();
    if (list.length === 0) throw new Error('No ChatGPT conversations found (are you logged in to chatgpt.com?).');
    const picked = selectAcrossTimeline(list, TOTAL_CONVOS);
    const convos: RawConversation[] = [];
    notify({ type: 'aibadges:cg-phase', phase: 'capture', done: 0, total: picked.length });
    for (let i = 0; i < picked.length; i++) {
      try { convos.push(await adapter.fetchConversation(picked[i].id)); } catch { /* skip one unreadable convo */ }
      notify({ type: 'aibadges:cg-phase', phase: 'capture', done: i + 1, total: picked.length });
    }
    bundle = buildChatGptExport(convos, new Date().toISOString(), { perConvoChars: PER_CONVO_CHARS, assistantHeadChars: ASSISTANT_HEAD_CHARS });
    await chrome.storage.local.set({ [CAPTURE_KEY]: JSON.stringify(bundle) });
  }
  const allConvos = bundle.export.conversations;
  if (allConvos.length === 0) throw new Error('Captured no readable conversation text.');

  // 2. Map-reduce analysis. MAP: extract evidence per batch, each batch a model turn in ITS OWN
  //    throwaway conversation inside a parallel background worker tab (runBatchesInTabs), pooled
  //    client-side into one id-stable set. REDUCE: synthesize the profile from the whole pool, then
  //    adversarially audit the four fluency bands — sequentially, in ONE throwaway conversation in
  //    THIS tab (the audit references the synthesis in-conversation). Every completed batch is
  //    checkpointed as it lands (order-independent); a batch that fails its retries is skipped
  //    rather than sinking the run; a synthesis failure aborts RESUMABLY (checkpoint kept); a
  //    failed audit degrades to importing the synthesis draft (combineForImport tolerates it).
  const batches = chunk(allConvos, BATCH_SIZE);
  const plan = planRun(ckptRaw, batches.length, Date.now());
  const totalSteps = batches.length + 2;
  const doneBatches: number[] = [...plan.doneBatches];
  const skippedBatches: number[] = [...plan.skippedBatches];
  const unitsByBatch: Record<string, RawUnit[]> = { ...plan.unitsByBatch };
  // Progress is counted in COMPLETED analysis steps (batches done or skipped, then synthesis, then
  // audit) so the popup's step labels stay truthful even when batches finish out of order.
  let done = doneBatches.length + skippedBatches.length + (plan.synthText ? 1 : 0);
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done, total: totalSteps });

  const token = await accessToken();
  if (plan.staleConvoId) await deleteConversation(plan.staleConvoId, token); // old throwaway from the interrupted run
  await cleanupBatchLeftovers(token); // stray worker conversations/results from the interrupted run
  const startedAt = new Date().toISOString();
  const main: TurnCtx = { token, preTopId: await topConversationId(token), id: null };

  const ckpt = (synthText?: string): AutorunCheckpoint => ({
    v: 2, startedAt, totalBatches: batches.length, doneBatches: [...doneBatches],
    skippedBatches: [...skippedBatches], unitsByBatch,
    ...(synthText ? { synthText } : {}), ...(main.id ? { convoId: main.id } : {}),
  });
  const runTurn = (prompt: string, timeoutMs: number) => runTurnIn(main, prompt, timeoutMs, notify);

  // Once the orchestrator's throwaway conversation exists it should not outlive the run: it is
  // deleted on success and on TERMINAL failure. On a RESUMABLE failure it is kept and recorded in
  // the checkpoint, and the next run deletes it before starting fresh — losing it would strand
  // analysis prompts in the user's history, but deleting it eagerly would also delete nothing of
  // value since every reply is already checkpointed. Worker tabs delete their own conversations.
  try {
    const remaining = batches.map((_, i) => i).filter((b) => !doneBatches.includes(b) && !skippedBatches.includes(b));
    if (remaining.length) {
      await runBatchesInTabs(remaining, notify, async (b, units) => {
        if (units) { unitsByBatch[b] = units; doneBatches.push(b); }
        else skippedBatches.push(b); // twice-failed batch: keep going with partial coverage
        await saveCkpt(ckpt());
        notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });
      });
    }
    const pooled = assemblePool(unitsByBatch, doneBatches);
    if (pooled.length === 0) {
      await clearCkpt();
      throw new Error('ChatGPT returned no usable evidence from your history.');
    }

    let synthText = plan.synthText;
    if (!synthText) {
      try {
        synthText = (await runTurn(buildSynthesisFromEvidence(pooled), REDUCE_TIMEOUT_MS)).text;
      } catch {
        await saveCkpt(ckpt()); // evidence pool is safe; next run resumes at synthesis
        throw new Error('The analysis was interrupted during synthesis. Run again to continue from where it stopped.');
      }
      await saveCkpt(ckpt(synthText));
      notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });
    }

    let auditText = '';
    try {
      // The audit turn references the synthesis in-conversation. On resume the synthesis happened in
      // the deleted throwaway, so replay it first in this fresh conversation to restore context.
      if (plan.synthText && !main.lastNode) {
        await runTurn(buildSynthesisFromEvidence(pooled), REDUCE_TIMEOUT_MS);
      }
      auditText = (await runTurn(buildAuditPrompt(), REDUCE_TIMEOUT_MS)).text;
    } catch { /* audit failed twice — import the synthesis draft instead of losing the run */ }
    notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });

    // 3. Delete the throwaway BEFORE signaling done (the done message closes this tab, which would
    //    abort an in-flight delete), then combine and import.
    if (main.id) await deleteConversation(main.id, token);
    await clearCkpt();
    const profile = await importGptReply(combineForImport(pooled, synthText, auditText));
    notify({ type: 'aibadges:done', version: profile.version });
    notify({ type: 'aibadges:cg-autorun-done', version: profile.version, skippedBatches: skippedBatches.length });
  } catch (e) {
    // Resumable failures keep the checkpoint (and its convoId for later cleanup). Terminal ones
    // (no evidence) cleared it above; delete the throwaway for those.
    const resumable = (await loadCkpt()) !== null;
    if (main.id && !resumable) await deleteConversation(main.id, token);
    throw e;
  }
}
