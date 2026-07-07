import { ChatGPTCaptureAdapter } from './chatgpt';
import { selectAcrossTimeline } from './select';
import { buildChatGptExport } from './chatgpt-export';
import { buildExtractionPrompt, buildSynthesisFromEvidence, buildAuditPrompt } from './chatgpt-prompt';
import { setComposer, clickSend, hasChallenge } from './chatgpt-bridge';
import { importGptReply, CAPTURE_KEY } from '../run/import-chatgpt';
import type { RawConversation } from './types';
import type { CaptureBundle } from '../run/import-chatgpt';

// Fully invisible ChatGPT run inside a (background) chatgpt.com tab: capture history, run the
// analysis in a throwaway conversation, read the reply from the backend API (which works even when
// the tab is hidden, unlike the DOM which does not render while backgrounded), delete the
// conversation, and import. Nothing is left in the user's ChatGPT history, mirroring how the Claude
// path uses a scratch conversation it deletes. The only DOM coupling is the submit (fill + send).
//
// RELIABILITY MODEL (added after real-world mid-flight failures): the run is 5+ sequential model
// turns, so it must survive any single turn dying. Every completed turn is checkpointed to
// chrome.storage.local; a re-run resumes from the checkpoint in a FRESH throwaway conversation
// (extraction and synthesis prompts are self-contained, so nothing depends on the old one, which
// gets deleted at resume). Long turns emit a heartbeat so the service worker's watchdog knows the
// run is alive; reply waits are step-aware and only time out after a minimum number of REAL polls,
// because hidden-tab timers are throttled to as little as one tick per minute.

type Notify = (m: Record<string, unknown>) => void;

const BASE = 'https://chatgpt.com';
const TOTAL_CONVOS = 90;           // captured across the whole history (was a single-prompt cap of 30)
const BATCH_SIZE = 30;             // conversations per extraction turn (map step): small enough that one
                                   // batch's evidence reply won't hit the model's output limit and truncate
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

// After a submit, ChatGPT navigates from "/" to "/c/{id}" a beat later (once the response starts), so
// the id is not there immediately. Poll the URL until it appears. Fallback (SPA route lagging in a
// throttled tab): take the most-recently-updated conversation — but ONLY if it is NEW since the run
// started (differs from preTopId). Otherwise the top chat is a real user conversation, and binding to
// it would post analysis prompts into, and later hide, a genuine chat. Fail loudly instead.
async function awaitConversationId(token: string, preTopId: string | null, timeoutMs = 45000, everyMs = 800): Promise<string | null> {
  const start = Date.now();
  let id = conversationId();
  while (!id && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, everyMs));
    id = conversationId();
  }
  if (id) return id;
  const top = await topConversationId(token);
  return top && top !== preTopId ? top : null;
}

// Fill the composer and click ChatGPT's own send button, retrying while React enables the button.
// A visible challenge means we cannot submit unattended, so surface it rather than hang.
async function submitPrompt(prompt: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (hasChallenge()) throw new Error('ChatGPT is showing a verification step. Open chatgpt.com, then run again.');
    if (setComposer(prompt) && clickSend()) return;
    await new Promise((r) => setTimeout(r, 300));
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

// ---- batched map-reduce helpers ----
type RawUnit = { conversationId: string; quote: string; summary: string; type: string };
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
// model's own ids are dropped — the caller assigns globally-unique ids across batches so citations
// stay stable regardless of how each batch numbered its units.
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
  v: 1;
  startedAt: string;       // ISO; a checkpoint older than CKPT_MAX_AGE_MS is discarded
  totalBatches: number;    // to detect a capture-shape mismatch (then the checkpoint is unusable)
  batchesDone: number;
  skippedBatches: number[]; // batches that failed twice and were skipped (coverage note)
  pooled: PooledUnit[];
  synthText?: string;      // present once synthesis completed
  convoId?: string;        // the old throwaway; deleted on resume (a fresh one is started)
}

export interface RunPlan {
  resume: boolean;
  batchesDone: number;
  skippedBatches: number[];
  pooled: PooledUnit[];
  synthText?: string;
  staleConvoId?: string;
}

const FRESH: RunPlan = { resume: false, batchesDone: 0, skippedBatches: [], pooled: [] };

// Decide what a run can reuse from a prior interrupted run. Pure, for tests. A stale or
// shape-mismatched checkpoint yields a fresh plan but still surfaces the old throwaway
// conversation id so it can be cleaned up.
export function planRun(raw: unknown, totalBatches: number, nowMs: number, maxAgeMs = CKPT_MAX_AGE_MS): RunPlan {
  const c = raw as AutorunCheckpoint | null | undefined;
  if (!c || typeof c !== 'object' || c.v !== 1 || !Array.isArray(c.pooled)) return FRESH;
  const stale = !c.startedAt || nowMs - Date.parse(c.startedAt) > maxAgeMs;
  if (stale || c.totalBatches !== totalBatches) return { ...FRESH, staleConvoId: c.convoId };
  return {
    resume: c.batchesDone > 0 || !!c.synthText,
    batchesDone: Math.min(c.batchesDone ?? 0, totalBatches),
    skippedBatches: Array.isArray(c.skippedBatches) ? c.skippedBatches : [],
    pooled: c.pooled,
    synthText: typeof c.synthText === 'string' && c.synthText ? c.synthText : undefined,
    staleConvoId: c.convoId,
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

  // 2. Map-reduce analysis in ONE throwaway conversation. MAP: extract evidence in batches (each a
  //    model turn) into a single client-owned, id-stable pool. REDUCE: synthesize the profile from
  //    the whole pool, then adversarially audit the four fluency bands. Every completed turn is
  //    checkpointed; a failed turn is retried once; a batch that fails twice is skipped rather than
  //    sinking the run; a synthesis failure aborts RESUMABLY (checkpoint kept); a failed audit
  //    degrades to importing the synthesis draft (combineForImport tolerates an empty audit).
  const batches = chunk(allConvos, BATCH_SIZE);
  const plan = planRun(ckptRaw, batches.length, Date.now());
  const totalSteps = batches.length + 2;
  let done = plan.batchesDone + (plan.synthText ? 1 : 0);
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done, total: totalSteps });

  const token = await accessToken();
  if (plan.staleConvoId) await deleteConversation(plan.staleConvoId, token); // old throwaway from the interrupted run
  const preTopId = await topConversationId(token);
  const pooled: PooledUnit[] = [...plan.pooled];
  const skippedBatches: number[] = [...plan.skippedBatches];
  const startedAt = new Date().toISOString();
  let id: string | null = null;
  let lastNode: string | undefined;

  const ckpt = (synthText?: string): AutorunCheckpoint => ({
    v: 1, startedAt, totalBatches: batches.length, batchesDone: doneBatches, skippedBatches,
    pooled, ...(synthText ? { synthText } : {}), ...(id ? { convoId: id } : {}),
  });
  let doneBatches = plan.batchesDone;

  // One model turn with a single retry. The first turn also binds the throwaway conversation id.
  const runTurn = async (prompt: string, timeoutMs: number): Promise<{ text: string; node: string }> => {
    for (let attempt = 1; ; attempt++) {
      try {
        await submitPrompt(prompt);
        if (!id) {
          id = await awaitConversationId(token, preTopId);
          if (!id) throw new Error('ChatGPT did not start a conversation.');
        }
        const reply = await awaitReply(id, token, notify, lastNode, timeoutMs);
        lastNode = reply.node;
        return reply;
      } catch (e) {
        if (attempt >= 2) throw e;
        notify({ type: 'aibadges:cg-heartbeat' });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  // Once the throwaway conversation exists it should not outlive the run: it is deleted on success
  // and on TERMINAL failure. On a RESUMABLE failure it is kept and recorded in the checkpoint, and
  // the next run deletes it before starting fresh — losing it would strand analysis prompts in the
  // user's history, but deleting it eagerly would also delete nothing of value since every reply is
  // already checkpointed.
  try {
    for (let b = doneBatches; b < batches.length; b++) {
      const subBundle = { export: { ...bundle.export, conversations: batches[b] }, idMap: bundle.idMap, capturedAt: bundle.capturedAt };
      try {
        const reply = await runTurn(buildExtractionPrompt(subBundle), EXTRACT_TIMEOUT_MS);
        for (const u of parseEvidence(reply.text)) pooled.push({ ...u, id: `e${pooled.length + 1}` });
      } catch {
        skippedBatches.push(b); // twice-failed batch: keep going with partial coverage
      }
      doneBatches = b + 1;
      await saveCkpt(ckpt());
      notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });
    }
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
      if (plan.synthText && !lastNode) {
        await runTurn(buildSynthesisFromEvidence(pooled), REDUCE_TIMEOUT_MS);
      }
      auditText = (await runTurn(buildAuditPrompt(), REDUCE_TIMEOUT_MS)).text;
    } catch { /* audit failed twice — import the synthesis draft instead of losing the run */ }
    notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });

    // 3. Delete the throwaway BEFORE signaling done (the done message closes this tab, which would
    //    abort an in-flight delete), then combine and import.
    if (id) await deleteConversation(id, token);
    await clearCkpt();
    const profile = await importGptReply(combineForImport(pooled, synthText, auditText));
    notify({ type: 'aibadges:done', version: profile.version });
    notify({ type: 'aibadges:cg-autorun-done', version: profile.version, skippedBatches: skippedBatches.length });
  } catch (e) {
    // Resumable failures keep the checkpoint (and its convoId for later cleanup). Terminal ones
    // (no evidence) cleared it above; delete the throwaway for those.
    const resumable = (await loadCkpt()) !== null;
    if (id && !resumable) await deleteConversation(id, token);
    throw e;
  }
}
