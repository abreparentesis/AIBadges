import { ChatGPTCaptureAdapter } from './chatgpt';
import { selectAcrossTimeline } from './select';
import { buildChatGptExport } from './chatgpt-export';
import { buildExtractionPrompt, buildSynthesisPrompt } from './chatgpt-prompt';
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
const MAX_CONVOS = 30;
const PER_CONVO_CHARS = 4000;

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

// After a submit, ChatGPT navigates from "/" to "/c/{id}" a beat later (once the response starts),
// so the id is not there immediately. Poll the URL until it appears. As a fallback (in case the SPA
// route lags badly in a throttled background tab), take the most recently updated conversation.
async function awaitConversationId(token: string, timeoutMs = 45000, everyMs = 800): Promise<string | null> {
  const start = Date.now();
  let id = conversationId();
  while (!id && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, everyMs));
    id = conversationId();
  }
  if (id) return id;
  try {
    const j = await fetch(`${BASE}/backend-api/conversations?offset=0&limit=1&order=updated`, {
      credentials: 'include', headers: { authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null));
    return j?.items?.[0]?.id ?? null;
  } catch { return null; }
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

// Merge the two replies into the single object the importer expects: evidence from step 1, everything
// else from step 2. Tolerant parsing (fenced block, trailing commas) mirrors the importer.
function combineForImport(evidenceReply: string, synthReply: string): string {
  const block = (raw: string): unknown => {
    const fence = raw.match(/```json\s*([\s\S]*?)```/i);
    const body = (fence ? fence[1] : raw).trim();
    const m = body.match(/[[{][\s\S]*[\]}]/);
    return JSON.parse((m ? m[0] : body).replace(/,(\s*[}\]])/g, '$1'));
  };
  let evidence: unknown[] = [];
  try {
    const e = block(evidenceReply) as unknown[] | { evidence?: unknown[] };
    evidence = Array.isArray(e) ? e : (Array.isArray(e.evidence) ? e.evidence : []);
  } catch { /* leave empty; the importer reports if nothing is usable */ }
  let synth: Record<string, unknown> = {};
  try { synth = block(synthReply) as Record<string, unknown>; } catch { /* leave empty */ }
  return JSON.stringify({ ...synth, evidence });
}

export async function runAutoProfile(notify: Notify): Promise<void> {
  // 1. Capture history (read-only), same as the manual path.
  const adapter = new ChatGPTCaptureAdapter();
  const list = await adapter.listConversations();
  if (list.length === 0) throw new Error('No ChatGPT conversations found (are you logged in to chatgpt.com?).');
  const picked = selectAcrossTimeline(list, MAX_CONVOS);
  const convos: RawConversation[] = [];
  notify({ type: 'aibadges:cg-phase', phase: 'capture', done: 0, total: picked.length });
  for (let i = 0; i < picked.length; i++) {
    try { convos.push(await adapter.fetchConversation(picked[i].id)); } catch { /* skip one unreadable convo */ }
    notify({ type: 'aibadges:cg-phase', phase: 'capture', done: i + 1, total: picked.length });
  }
  const bundle = buildChatGptExport(convos, new Date().toISOString(), { perConvoChars: PER_CONVO_CHARS });
  if (bundle.export.conversations.length === 0) throw new Error('Captured no readable conversation text.');
  await chrome.storage.local.set({ [CAPTURE_KEY]: JSON.stringify(bundle) });

  // 2. Two-message analysis in ONE throwaway conversation: extract a rich evidence set, then
  //    synthesize the profile from it (so the model mines far more evidence than one combined reply).
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: 0, total: 2 });
  const token = await accessToken();
  await submitPrompt(buildExtractionPrompt(bundle));
  const id = await awaitConversationId(token);
  if (!id) throw new Error('ChatGPT did not start a conversation.');
  const step1 = await awaitReply(id, token);
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: 1, total: 2 });

  await submitPrompt(buildSynthesisPrompt());
  const step2 = await awaitReply(id, token, step1.node); // wait for a reply AFTER step 1's
  await deleteConversation(id, token);
  notify({ type: 'aibadges:cg-phase', phase: 'analysis', done: 2, total: 2 });

  // 3. Combine (evidence from step 1 + synthesis from step 2) and import.
  const profile = await importGptReply(combineForImport(step1.text, step2.text));
  notify({ type: 'aibadges:done', version: profile.version });
  notify({ type: 'aibadges:cg-autorun-done', version: profile.version });
}
