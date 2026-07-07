/**
 * PRISM known-groups validation prep. Downloads the PRISM Alignment survey +
 * conversations (HF datasets-server), stratifies users by self-reported LLM
 * familiarity (high vs low), and writes per-user eval dirs compatible with
 * eval-api.ts, plus eval/prism/groups.json for the aggregator.
 *
 *   bun scripts/prism-prep.ts [usersPerGroup=10]
 *
 * Evaluation-only use (CC-BY-NC on model outputs). Decision record:
 * docs/research/rating-calibration-datasets.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { RawConversation } from '../src/capture/types';

const PER_GROUP = Number(process.argv[2]) || 10;
const BASE = 'https://datasets-server.huggingface.co/rows?dataset=HannahRoseKirk%2Fprism-alignment';
const PAGE = 100;

async function fetchAll(config: string, max: number): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      const res = await fetch(`${BASE}&config=${config}&split=train&offset=${offset}&length=${PAGE}`).catch(() => null);
      if (res?.ok) {
        const data = (await res.json()) as any;
        for (const r of data.rows ?? []) rows.push(r.row);
        ok = true;
        if ((data.rows ?? []).length < PAGE) return rows;
      } else await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (!ok) console.error(`${config}: page at ${offset} failed 3x; skipping`);
  }
  return rows;
}

console.error('fetching survey…');
const survey = await fetchAll('survey', 2000);
console.error(`survey rows: ${survey.length}`);

const levels = [...new Set(survey.map((s) => s.lm_familiarity))];
console.error('familiarity levels:', levels);

// Order levels from the labels themselves: "Very familiar" > "Somewhat familiar" > "Not familiar..." etc.
const rank = (l: string) =>
  /very/i.test(l) ? 3 : /somewhat|moderat/i.test(l) ? 2 : 1;

const eligible = survey.filter(
  (s) =>
    !s.survey_only &&
    (s.num_completed_conversations ?? 0) >= 5 &&
    /fluent|native/i.test(String(s.english_proficiency ?? 'fluent')),
);
const sorted = (want: number) =>
  eligible
    .filter((s) => rank(String(s.lm_familiarity)) === want)
    .sort((a, b) => (b.num_completed_conversations ?? 0) - (a.num_completed_conversations ?? 0));
const high = sorted(3).slice(0, PER_GROUP);
const low = sorted(1).slice(0, PER_GROUP);
console.error(`high-familiarity users: ${high.length}, low: ${low.length} (eligible pool ${eligible.length})`);

console.error('fetching conversations…');
const convos = await fetchAll('conversations', 9000);
console.error(`conversation rows: ${convos.length}`);

const wanted = new Map<string, { group: 'high' | 'low'; survey: any }>();
for (const s of high) wanted.set(s.user_id, { group: 'high', survey: s });
for (const s of low) wanted.set(s.user_id, { group: 'low', survey: s });

const byUser = new Map<string, any[]>();
for (const c of convos) {
  if (!wanted.has(c.user_id)) continue;
  const list = byUser.get(c.user_id) ?? [];
  list.push(c);
  byUser.set(c.user_id, list);
}

const groups: Record<string, { group: string; familiarity: string; frequency: string; conversations: number }> = {};
for (const [userId, info] of wanted) {
  const userConvos = byUser.get(userId) ?? [];
  if (userConvos.length === 0) continue;
  const raw: RawConversation[] = userConvos.map((c: any, i: number) => {
    const messages: { role: 'user' | 'assistant'; text: string }[] = [];
    for (const h of c.conversation_history ?? []) {
      const isUser = h.role === 'user';
      const chosen = String(h.if_chosen) === 'true' || h.if_chosen === true;
      if (!isUser && !chosen) continue; // keep only the model response the user picked
      const text = String(h.content ?? '').trim();
      if (text) messages.push({ role: isUser ? 'user' : 'assistant', text });
    }
    return {
      id: String(c.conversation_id ?? i),
      title: String(c.conversation_type ?? ''),
      createdAt: String(c.generated_datetime ?? new Date(0).toISOString()),
      messages,
    };
  }).filter((c) => c.messages.length > 0);

  const dir = `eval/prism/${userId}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/convos.json`, JSON.stringify(raw));
  groups[userId] = {
    group: info.group,
    familiarity: String(info.survey.lm_familiarity),
    frequency: String(info.survey.lm_frequency_use),
    conversations: raw.length,
  };
  console.error(`${userId} (${info.group}): ${raw.length} conversations`);
}

mkdirSync('eval/prism', { recursive: true });
writeFileSync('eval/prism/groups.json', JSON.stringify(groups, null, 2));
console.log(`prepared ${Object.keys(groups).length} users -> eval/prism/ (groups.json written)`);
