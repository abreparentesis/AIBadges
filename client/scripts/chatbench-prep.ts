/**
 * ChatBench delta-anchor validation prep. Reads the downloaded full-study
 * files (user_answers.csv + conversations.json), computes each worker's
 * alone (phase 1) vs AI-assisted (phase 2) accuracy, stratifies workers by
 * the assisted-minus-alone delta, and writes per-worker eval dirs for
 * eval-api.ts plus eval/chatbench/anchors.json for the aggregator.
 *
 *   bun scripts/chatbench-prep.ts <answers.csv> <conversations.json> [workers=10]
 *
 * Decision record: docs/research/rating-calibration-datasets.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { RawConversation } from '../src/capture/types';

const [answersPath, convosPath, nArg] = process.argv.slice(2);
if (!answersPath || !convosPath) {
  console.error('usage: bun scripts/chatbench-prep.ts <user_answers.csv> <conversations.json> [workers=10]');
  process.exit(1);
}
const N_WORKERS = Number(nArg) || 10;
const MIN_CONVOS = 8;
const MIN_ALONE = 8;

// minimal CSV parse (no quoted commas in the numeric fields we need)
function parseCsv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map((l) => {
    const vals = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']));
  });
}

const answers = parseCsv(answersPath);
const convos = JSON.parse(readFileSync(convosPath, 'utf8')) as any[];

interface Acc { n: number; correct: number }
const alone = new Map<string, Acc>();
for (const a of answers) {
  if (a.phase !== '1') continue;
  const acc = alone.get(a.worker_id) ?? { n: 0, correct: 0 };
  acc.n++;
  acc.correct += a.acc === '1' ? 1 : 0;
  alone.set(a.worker_id, acc);
}

const byWorker = new Map<string, any[]>();
for (const c of convos) {
  const list = byWorker.get(c.worker_id) ?? [];
  list.push(c);
  byWorker.set(c.worker_id, list);
}

interface Candidate { worker: string; convos: any[]; aloneAcc: number; assistedAcc: number; delta: number }
const candidates: Candidate[] = [];
for (const [worker, list] of byWorker) {
  const al = alone.get(worker);
  if (!al || al.n < MIN_ALONE || list.length < MIN_CONVOS) continue;
  const assisted = list.filter((c) => c.acc === 1 || c.acc === '1').length / list.length;
  const aloneAcc = al.correct / al.n;
  candidates.push({ worker, convos: list, aloneAcc, assistedAcc: assisted, delta: assisted - aloneAcc });
}
candidates.sort((a, b) => a.delta - b.delta);
console.error(`eligible workers (≥${MIN_CONVOS} convos, ≥${MIN_ALONE} alone answers): ${candidates.length}`);

// stratify across the delta range: bottom 3, middle 4, top 3
const pick: Candidate[] = [];
const take = (arr: Candidate[], n: number) => arr.slice(0, n);
if (candidates.length <= N_WORKERS) pick.push(...candidates);
else {
  const third = Math.floor(N_WORKERS / 3);
  const midStart = Math.floor(candidates.length / 2 - (N_WORKERS - 2 * third) / 2);
  pick.push(
    ...take(candidates, third),
    ...candidates.slice(midStart, midStart + (N_WORKERS - 2 * third)),
    ...take([...candidates].reverse(), third),
  );
}

const anchors: Record<string, { aloneAcc: number; assistedAcc: number; delta: number; conversations: number }> = {};
for (const c of pick) {
  const raw: RawConversation[] = c.convos.map((conv: any, i: number) => ({
    id: `${c.worker}-${conv.batch}-${conv.position}`,
    title: String(conv.subject ?? ''),
    // no timestamps in ChatBench; synthesize a stable order from batch/position
    createdAt: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    messages: (conv.chat_history ?? [])
      .filter((m: any) => m?.content)
      .map((m: any) => ({
        role: String(m.role).toLowerCase() === 'user' ? ('user' as const) : ('assistant' as const),
        text: String(m.content),
      })),
  })).filter((r: RawConversation) => r.messages.some((m) => m.role === 'user'));

  const dir = `eval/chatbench/${c.worker}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/convos.json`, JSON.stringify(raw));
  anchors[c.worker] = {
    aloneAcc: Number(c.aloneAcc.toFixed(3)),
    assistedAcc: Number(c.assistedAcc.toFixed(3)),
    delta: Number(c.delta.toFixed(3)),
    conversations: raw.length,
  };
  console.error(`${c.worker}: ${raw.length} convos, alone ${c.aloneAcc.toFixed(2)}, assisted ${c.assistedAcc.toFixed(2)}, delta ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(2)}`);
}

mkdirSync('eval/chatbench', { recursive: true });
writeFileSync('eval/chatbench/anchors.json', JSON.stringify(anchors, null, 2));
console.log(`prepared ${Object.keys(anchors).length} workers -> eval/chatbench/ (anchors.json written)`);
