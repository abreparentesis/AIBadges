/**
 * WildChat calibration source for the staged eval harness (local-eval.ts).
 *
 * Pages the HF datasets-server rows API for allenai/WildChat-1M, groups
 * conversations by hashed_ip, keeps English users with >= MIN conversations,
 * and writes one eval dir per user (eval/wildchat/u<k>/) containing
 * convos.json + evidence-prompt.txt in exactly the shape local-eval's later
 * stages consume. Run those stages per user with EVAL_DIR:
 *
 *   bun scripts/wildchat-prep.ts [rows=3000] [minConvos=8] [maxUsers=5]
 *   EVAL_DIR=eval/wildchat/u1 bun scripts/local-eval.ts score | audit | report
 *
 * Decision record: docs/research/rating-calibration-datasets.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { evidencePrompt } from '../src/prompts';
import { selectAcrossTimeline } from '../src/capture/select';
import type { RawConversation } from '../src/capture/types';

const ROWS = Number(process.argv[2]) || 3000;
const MIN_CONVOS = Number(process.argv[3]) || 8;
const MAX_USERS = Number(process.argv[4]) || 5;
const PAGE = 100;
const API = 'https://datasets-server.huggingface.co/rows?dataset=allenai%2FWildChat-1M&config=default&split=train';
const N_SAMPLE = 60; // same timeline sampling budget as local-eval prep
const PER_CONVO = 2500;
const A_HEAD = 160;

interface WildRow {
  conversation_hash: string;
  timestamp: string;
  language: string;
  hashed_ip: string;
  conversation: { role: string; content: string }[];
}

// Mirrors local-eval's userCentric: keep user turns, clip assistant heads.
function clip(c: RawConversation): RawConversation {
  let budget = PER_CONVO;
  const messages = [];
  for (const m of c.messages) {
    if (budget <= 0) break;
    let text = m.text;
    if (m.role === 'assistant' && text.length > A_HEAD) text = text.slice(0, A_HEAD);
    if (text.length > budget) text = text.slice(0, budget);
    if (!text) continue;
    budget -= text.length;
    messages.push({ ...m, text });
  }
  return { ...c, messages };
}

async function fetchRows(): Promise<WildRow[]> {
  const rows: WildRow[] = [];
  for (let offset = 0; offset < ROWS; offset += PAGE) {
    const res = await fetch(`${API}&offset=${offset}&length=${PAGE}`);
    if (!res.ok) {
      console.error(`rows API ${res.status} at offset ${offset}; continuing with ${rows.length} rows`);
      break;
    }
    const data = (await res.json()) as any;
    for (const r of data.rows ?? []) rows.push(r.row as WildRow);
    if ((data.rows ?? []).length < PAGE) break;
  }
  return rows;
}

const rows = await fetchRows();
console.log(`fetched ${rows.length} rows`);

const byUser = new Map<string, WildRow[]>();
for (const r of rows) {
  if (r.language !== 'English' || !r.hashed_ip) continue;
  const list = byUser.get(r.hashed_ip) ?? [];
  list.push(r);
  byUser.set(r.hashed_ip, list);
}

const candidates = [...byUser.entries()]
  .map(([ip, convos]) => {
    // dedupe regenerations of the same conversation
    const seen = new Map<string, WildRow>();
    for (const c of convos) if (!seen.has(c.conversation_hash)) seen.set(c.conversation_hash, c);
    return { ip, convos: [...seen.values()] };
  })
  .filter((u) => u.convos.length >= MIN_CONVOS)
  .sort((a, b) => b.convos.length - a.convos.length)
  .slice(0, MAX_USERS);

console.log(
  `users with >=${MIN_CONVOS} English conversations in window: ${candidates.length}` +
  (candidates.length ? ` (sizes: ${candidates.map((u) => u.convos.length).join(', ')})` : ''),
);

candidates.forEach((u, k) => {
  const raw: RawConversation[] = u.convos.map((c, i) => ({
    id: c.conversation_hash ?? String(i),
    title: '',
    createdAt: new Date(c.timestamp).toISOString(),
    messages: (c.conversation ?? [])
      .filter((m) => m?.content)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.content) })),
  })).filter((c) => c.messages.length > 0);

  const picked = selectAcrossTimeline(raw.map((c) => ({ id: c.id, updatedAt: c.createdAt })), N_SAMPLE);
  const ids = new Set(picked.map((p) => p.id));
  const convos = raw.filter((c) => ids.has(c.id)).map(clip).filter((c) => c.messages.length > 0);

  const dir = `eval/wildchat/u${k + 1}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/convos.json`, JSON.stringify(convos));
  writeFileSync(`${dir}/evidence-prompt.txt`, evidencePrompt(convos));
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ hashedIp: u.ip, conversations: convos.length, span: [convos[0]?.createdAt, convos[convos.length - 1]?.createdAt] }));
  console.log(`u${k + 1}: ${convos.length} conversations -> ${dir}/ (subagent on evidence-prompt.txt -> evidence.json, then EVAL_DIR=${dir} bun scripts/local-eval.ts score)`);
});
