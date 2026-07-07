/**
 * Staged local eval harness. Runs the REAL scoring pieces (evidencePrompt -> capabilityPrompt ->
 * capabilityAuditPrompt -> assembleProfile, incl. the substance gate) against a downloaded ChatGPT
 * export, on a fixed local dataset. A Bun script can't call Claude subagents mid-run, so each model
 * step is a STAGE: the script writes a prompt file, the operator (me) runs a subagent on it and saves
 * the reply, the next stage consumes it. Nothing leaves the machine except the prompts I hand to a
 * subagent. Lets us iterate prompts/engine and judge the bands directly, user uninvolved.
 *
 *   bun scripts/local-eval.ts prep <conversations.json> [N=60]   -> eval/evidence-prompt.txt
 *   (subagent on evidence-prompt.txt, raw JSON array) -> eval/evidence.json
 *   bun scripts/local-eval.ts score                              -> eval/cap-prompt.txt
 *   (subagent on cap-prompt.txt) -> eval/cap-draft.json
 *   bun scripts/local-eval.ts audit                              -> eval/audit-prompt.txt
 *   (subagent on audit-prompt.txt) -> eval/cap-final.json
 *   bun scripts/local-eval.ts report                             -> prints bands + notes + quotes
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { linearizeMapping } from '../src/capture/chatgpt';
import { selectAcrossTimeline } from '../src/capture/select';
import { evidencePrompt, capabilityPrompt, capabilityAuditPrompt } from '../src/prompts';
import { assembleProfile } from '../src/engine/assemble';
import type { RawConversation } from '../src/capture/types';
import type { EvidenceUnit, Capability } from '../src/engine/types';

const DIR = process.env.EVAL_DIR || 'eval'; // per-user dirs for the WildChat calibration source
const EV_TYPES = ['decision', 'reasoning_move', 'episode', 'preference'];
const toIso = (t: unknown): string => {
  const n = typeof t === 'number' ? t : Number(t);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : new Date(0).toISOString();
};
const read = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');
const write = (f: string, s: string) => writeFileSync(`${DIR}/${f}`, s);

// Tolerant JSON extraction from a subagent reply (fenced block, prose around it, trailing commas).
function loose(raw: string): any {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : raw).trim();
  const m = body.match(/[[{][\s\S]*[\]}]/);
  return JSON.parse((m ? m[0] : body).replace(/,(\s*[}\]])/g, '$1'));
}

// ChatGPT export = array of { title, create_time, mapping, current_node }.
function parseExport(path: string): RawConversation[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as any[])
    .map((c, i) => ({ id: String(c.conversation_id ?? c.id ?? i), title: String(c.title ?? ''), createdAt: toIso(c.create_time), messages: linearizeMapping(c.mapping, c.current_node) }))
    .filter((c) => c.messages.length > 0);
}

// User-centric: keep the user's turns, clip each assistant turn to a short head (mirrors the extension).
function userCentric(convos: RawConversation[], perConvo = 2500, aHead = 160): RawConversation[] {
  return convos.map((c) => {
    let budget = perConvo; const messages = [];
    for (const m of c.messages) {
      if (budget <= 0) break;
      let text = m.text;
      if (m.role === 'assistant' && text.length > aHead) text = text.slice(0, aHead);
      if (text.length > budget) text = text.slice(0, budget);
      if (!text) continue;
      budget -= text.length; messages.push({ ...m, text });
    }
    return { ...c, messages };
  }).filter((c) => c.messages.length > 0);
}

function evidenceUnits(convos: RawConversation[], raw: any): EvidenceUnit[] {
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.evidence) ? raw.evidence : []);
  const units: EvidenceUnit[] = [];
  let n = 0;
  for (const r of arr) {
    const label = parseInt(String(r?.conversationLabel ?? r?.conversationId ?? '').match(/\d+/)?.[0] ?? '', 10);
    const convo = convos[label - 1];
    if (!convo || typeof r?.quote !== 'string' || !r.quote) continue;
    units.push({
      id: `e${++n}`, timestamp: (typeof r.timestamp === 'string' && r.timestamp) ? r.timestamp : convo.createdAt,
      sourceRef: { provider: 'chatgpt', conversationId: convo.id },
      type: EV_TYPES.includes(r.type) ? r.type : 'episode', quote: r.quote, summary: typeof r.summary === 'string' ? r.summary : '',
    });
  }
  return units;
}

function printProfile(units: EvidenceUnit[], cap: Capability): void {
  const p = assembleProfile(
    { thinking: [], trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [] }, capability: cap, evidence: units },
    { version: 1, now: new Date().toISOString(), modelProvenance: 'eval', sourceWindow: { fromDate: new Date().toISOString(), toDate: new Date().toISOString(), conversationCount: 0 } },
  );
  const by = new Map((p.evidence ?? []).map((e) => [e.id, e]));
  const convos = new Set((p.evidence ?? []).map((e) => e.sourceRef.conversationId)).size;
  console.log(`\n=== ${p.evidence?.length ?? 0} evidence units / ${convos} conversations · stage ${p.capability!.yeggeStage.stage}/8 (derived from the audited bands; a model-emitted stage is ignored by design) ===`);
  for (const k of ['delegation', 'description', 'discernment', 'diligence'] as const) {
    const d = p.capability!.aiFluency[k];
    console.log(`\n${k.toUpperCase()} — ${d.band.toUpperCase()}`);
    console.log(`  note: ${d.note ?? '(none)'}`);
    for (const id of d.evidenceIds) console.log(`    "${by.get(id)?.quote}"`);
    if (!d.evidenceIds.length) console.log('    (no surviving quotes)');
  }
}

const stage = process.argv[2];
mkdirSync(DIR, { recursive: true });

if (stage === 'prep') {
  const path = process.argv[3]; const N = Number(process.argv[4]) || 60;
  const all = parseExport(path);
  const picked = selectAcrossTimeline(all.map((c) => ({ id: c.id, updatedAt: c.createdAt })), N);
  const ids = new Set(picked.map((p) => p.id));
  const convos = userCentric(all.filter((c) => ids.has(c.id)));
  write('convos.json', JSON.stringify(convos));
  write('evidence-prompt.txt', evidencePrompt(convos));
  console.log(`prep: loaded ${all.length}, sampled ${convos.length} -> eval/evidence-prompt.txt (run a subagent -> eval/evidence.json as a raw JSON array)`);
} else if (stage === 'score') {
  const convos: RawConversation[] = JSON.parse(read('convos.json'));
  const units = evidenceUnits(convos, loose(read('evidence.json')));
  write('evidence-units.json', JSON.stringify(units));
  write('cap-prompt.txt', capabilityPrompt(units));
  console.log(`score: ${units.length} evidence units -> eval/cap-prompt.txt (subagent -> eval/cap-draft.json)`);
} else if (stage === 'audit') {
  const units: EvidenceUnit[] = JSON.parse(read('evidence-units.json'));
  const draft: Capability = loose(read('cap-draft.json'));
  write('audit-prompt.txt', capabilityAuditPrompt(units, draft));
  console.log('audit -> eval/audit-prompt.txt (subagent -> eval/cap-final.json)');
} else if (stage === 'report') {
  const units: EvidenceUnit[] = JSON.parse(read('evidence-units.json'));
  const capFile = existsSync(`${DIR}/cap-final.json`) ? 'cap-final.json' : 'cap-draft.json';
  printProfile(units, loose(read(capFile)));
} else {
  console.error('stages: prep <export> [N] | score | audit | report');
  process.exit(1);
}
