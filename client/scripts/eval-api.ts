/**
 * API eval harness: run the REAL scoring pipeline against a downloaded ChatGPT export, routing every
 * model call through OpenRouter -> openai/gpt-5.5 (high reasoning effort) — the user's actual target
 * model. Fully automated (the OpenAI API is scriptable, unlike the bot-gated ChatGPT UI). Lets us
 * fine-tune the prompts for GPT-5.x robustness and judge the bands directly, user uninvolved.
 *
 *   phase run --app-id 075a8ab8-78d4-4f75-9fdd-a94ba7d1712e --env Development --path /global -- \
 *     bun scripts/eval-api.ts <conversations.json> [N=25] [--full]
 *
 * OPENROUTER_API_KEY is injected by `phase run`; nothing is sent to any AIBadges server.
 */
import { readFileSync } from 'node:fs';
import { linearizeMapping } from '../src/capture/chatgpt';
import { selectAcrossTimeline } from '../src/capture/select';
import { buildProfile } from '../src/engine/profile';
import type { RawConversation } from '../src/capture/types';
import type { ModelCaller } from '../src/inference/types';
import type { Profile } from '../src/engine/types';

const MODEL = 'openai/gpt-5.5';
const toIso = (t: unknown): string => {
  const n = typeof t === 'number' ? t : Number(t);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : new Date(0).toISOString();
};

function parseExport(path: string): RawConversation[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as any[])
    .map((c, i) => ({ id: String(c.conversation_id ?? c.id ?? i), title: String(c.title ?? ''), createdAt: toIso(c.create_time), messages: linearizeMapping(c.mapping, c.current_node) }))
    .filter((c) => c.messages.length > 0);
}

// OpenRouter -> openai/gpt-5.5, high reasoning effort. One call per model step.
function openrouterCaller(): ModelCaller {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set (run under `phase run ... -- bun ...`)');
  return {
    async complete(prompt) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, reasoning: { effort: 'high' }, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const j = await res.json() as any;
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text) throw new Error(`empty completion: ${JSON.stringify(j).slice(0, 300)}`);
      return text;
    },
  };
}

function report(p: Profile, full: boolean): void {
  const by = new Map((p.evidence ?? []).map((e) => [e.id, e]));
  const convos = new Set((p.evidence ?? []).map((e) => e.sourceRef.conversationId)).size;
  console.log(`\n=== GPT-5.5 · ${p.evidence?.length ?? 0} evidence units / ${convos} conversations · stage ${p.capability?.yeggeStage.stage ?? '-'}/8 ===`);
  const cap = p.capability;
  if (cap) for (const k of ['delegation', 'description', 'discernment', 'diligence'] as const) {
    const d = cap.aiFluency[k];
    console.log(`\n${k.toUpperCase()} — ${d.band.toUpperCase()}`);
    console.log(`  note: ${d.note ?? '(none)'}`);
    for (const id of d.evidenceIds) console.log(`    "${by.get(id)?.quote}"`);
    if (!d.evidenceIds.length) console.log('    (no surviving quotes)');
  }
  if (full) { console.log('\n--- THINKING ---'); for (const c of p.thinking) console.log(`• [${c.confidence}] ${c.claim}`); }
}

async function main() {
  const [path, nArg, ...rest] = process.argv.slice(2);
  if (!path) { console.error('usage: phase run ... -- bun scripts/eval-api.ts <conversations.json> [N] [--full]'); process.exit(1); }
  const N = Number(nArg) > 0 ? Number(nArg) : 25;
  const full = rest.includes('--full') || nArg === '--full';

  const all = parseExport(path);
  const picked = selectAcrossTimeline(all.map((c) => ({ id: c.id, updatedAt: c.createdAt })), N);
  const ids = new Set(picked.map((p) => p.id));
  const convos = all.filter((c) => ids.has(c.id));
  console.log(`Loaded ${all.length}; scoring ${convos.length} via ${MODEL} (high effort)…`);

  const t0 = Date.now();
  const profile = await buildProfile(convos, openrouterCaller(), {
    version: 1, now: new Date().toISOString(), modelProvenance: `gpt-5.5-high`,
    fastModel: MODEL, bestModel: MODEL, perConvoChars: 2500, maxChars: 40000, concurrency: 2,
    onPhase: (ph) => console.error(`  ${ph.phase}: ${ph.done}/${ph.total}`),
  });
  report(profile, full);
  console.log(`(done in ${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
