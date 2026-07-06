import { ChatGPTCaptureAdapter } from './chatgpt';
import { selectAcrossTimeline } from './select';
import { buildChatGptExport } from './chatgpt-export';
import { buildExtractionPrompt, buildSynthesisFromEvidence, buildAuditPrompt } from './chatgpt-prompt';
import { setComposer, clickSend, hasChallenge } from './chatgpt-bridge';
import { importGptReply, CAPTURE_KEY } from '../run/import-chatgpt';
import type { RawConversation } from './types';

// Fully invisible ChatGPT run inside a (background) chatgpt.com tab: capture history, run the
// analysis in a throwaway conversation, read the reply from the backend API (which works even when
// the tab is hidden, unlike the DOM which does not render while backgrounded), delete the
// conversation, and import. Nothing is left in the user's ChatGPT history, mirroring how the Claude
// path uses a scratch conversation it deletes. The only DOM coupling is the submit (fill + send).

type Notify = (m: Record<string, unknown>) => void;

const BASE = 'https://chatgpt.com';
const TOTAL_CONVOS = 90;           // captured across the whole history (was a single-prompt cap of 30)
const BATCH_SIZE = 30;             // conversations per extraction turn (map step): small enough that one
                                   // batch's evidence reply won't hit the model's output limit and truncate
const PER_CONVO_CHARS = 2500;      // user-centric capture packs a chat into far less than the old 4000
const ASSISTANT_HEAD_CHARS = 160;  // keep only a short head of each AI turn — enough to judge a reaction

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

// Poll the conversation over the API until the latest assistant reply is finished, then return it.
// Independent of DOM rendering, so it completes while the tab is backgrounded. excludeNode lets the
// caller wait for a NEW reply — the second message must not return the first message's finished reply.
async function awaitReply(id: string, token: string, excludeNode?: string, timeoutMs = 180000, everyMs = 1500):
  Promise<{ text: string; node: string }> {
  const start = Date.now();
  let latest = { text: '', node: '' };
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, everyMs));
    const c = await fetch(`${BASE}/backend-api/conversation/${encodeURIComponent(id)}`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!c?.mapping) continue;
    const r = replyAtCurrentNode(c.mapping as Record<string, CGNode>, c.current_node);
    if (!r || (excludeNode && r.node === excludeNode)) continue; // no reply yet, or still the previous one
    if (r.text) latest = { text: r.text, node: r.node };
    if (r.status === 'finished_successfully' && r.text) return { text: r.text, node: r.node };
  }
  if (latest.text) return latest; // finished flag never arrived but we have a full-looking reply
  throw new Error('Timed out waiting for the ChatGPT reply.');
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

export async function runAutoProfile(notify: Notify): Promise<void> {
  // 1. Capture history (read-only, user-centric) across the whole timeline.
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
  const bundle = buildChatGptExport(convos, new Date().toISOString(), { perConvoChars: PER_CONVO_CHARS, assistantHeadChars: ASSISTANT_HEAD_CHARS });
  const allConvos = bundle.export.conversations;
  if (allConvos.length === 0) throw new Error('Captured no readable conversation text.');
  await chrome.storage.local.set({ [CAPTURE_KEY]: JSON.stringify(bundle) });

  // 2. Map-reduce analysis in ONE throwaway conversation. MAP: extract evidence in batches (each a
  //    model turn) into a single client-owned, id-stable pool — this covers far more chats than one
  //    prompt could hold, and the client owns the ids so citations can't drift across batches. REDUCE:
  //    synthesize the profile from the whole pool, then adversarially audit the four fluency bands.
  const batches = chunk(allConvos, BATCH_SIZE);
  const totalSteps = batches.length + 2; // K extraction turns + synthesis + audit
  let done = 0;
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done, total: totalSteps });

  const token = await accessToken();
  const preTopId = await topConversationId(token); // to tell a NEW conversation from a real one in the fallback
  const pooled: PooledUnit[] = [];
  let id: string | null = null;
  let lastNode: string | undefined;
  // Once the throwaway conversation exists it MUST be deleted on every exit path — a reply timeout on
  // any later turn would otherwise leave it visible in the user's real ChatGPT history, breaking the
  // "nothing is left behind" invariant. Delete before signaling done (the done message closes this
  // tab, which would abort an in-flight delete), and delete on any failure before rethrowing.
  try {
    for (const batch of batches) {
      const subBundle = { export: { ...bundle.export, conversations: batch }, idMap: bundle.idMap, capturedAt: bundle.capturedAt };
      await submitPrompt(buildExtractionPrompt(subBundle));
      if (!id) { id = await awaitConversationId(token, preTopId); if (!id) throw new Error('ChatGPT did not start a conversation.'); }
      const reply = await awaitReply(id, token, lastNode); // wait for the reply AFTER the previous turn's
      lastNode = reply.node;
      for (const u of parseEvidence(reply.text)) pooled.push({ ...u, id: `e${pooled.length + 1}` });
      notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });
    }
    if (pooled.length === 0) throw new Error('ChatGPT returned no usable evidence from your history.');

    await submitPrompt(buildSynthesisFromEvidence(pooled));
    const synth = await awaitReply(id!, token, lastNode); lastNode = synth.node;
    notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });

    await submitPrompt(buildAuditPrompt());
    const audit = await awaitReply(id!, token, lastNode);
    notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: ++done, total: totalSteps });

    // 3. Delete the throwaway BEFORE signaling done, then combine and import.
    await deleteConversation(id!, token);
    const profile = await importGptReply(combineForImport(pooled, synth.text, audit.text));
    notify({ type: 'aibadges:done', version: profile.version });
    notify({ type: 'aibadges:cg-autorun-done', version: profile.version });
  } catch (e) {
    if (id) await deleteConversation(id, token); // clean up the throwaway even on failure/timeout
    throw e;
  }
}
