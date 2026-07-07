import type { RawConversation } from '../capture/types';
import type { ModelCaller } from '../inference/types';
import { EvidenceUnit, EvidenceUnitSchema } from './types';
import { chunkConversations } from './chunk';
import { parseJsonResponse } from './json';
import { evidencePrompt, evidenceReactionPrompt } from '../prompts';
import { dedupeMoments } from './evidence-pool';
import { mapLimit } from './parallel';
import { isRateLimitError } from '../inference/in-session';

interface RawEvidence { conversationLabel: number; timestamp?: string; type: string; quote: string; summary: string; }

function normalize(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'") // curly single quotes -> '
    .replace(/[“”„‟]/g, '"') // curly double quotes -> "
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Longest run of consecutive words from `q` that appears in order within `src`, as a
// fraction of q's words. Requires real contiguous overlap (word order preserved), so a
// quote stitched or reordered from the source's vocabulary does NOT pass — only genuine
// (possibly lightly-trimmed) quotes do.
function contiguousWordRatio(q: string, src: string): number {
  const qw = q.split(' ').filter(Boolean);
  if (qw.length === 0) return 0;
  const haystack = ` ${src} `;
  let best = 0;
  for (let i = 0; i < qw.length; i++) {
    for (let len = best + 1; i + len <= qw.length; len++) {
      if (haystack.includes(` ${qw.slice(i, i + len).join(' ')} `)) best = len; else break;
    }
  }
  return best / qw.length;
}

/**
 * Returns true if `quote` plausibly comes from `sourceText` (the conversation the model saw).
 * Tolerant of elision and light trimming; rejects fabricated quotes with low character overlap.
 */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  let q = normalize(quote);
  // strip a leading/trailing straight quote left over from the model
  q = q.replace(/^"+/, '').replace(/"+$/, '').trim();
  const src = normalize(sourceText);

  if (q.length < 8) return true; // too short to verify; don't drop
  if (src.includes(q)) return true;

  // elided quote: "A ... B" — every meaningful fragment must appear
  const fragments = q.split(/\.\.\.|…/).map((f) => f.trim()).filter((f) => f.length >= 8);
  if (fragments.length >= 2 && fragments.every((f) => src.includes(f))) return true;

  // light trimming: a long contiguous run of the quote's words must appear in order.
  return contiguousWordRatio(q, src) >= 0.6;
}

export interface ExtractOpts {
  maxChars?: number;
  maxChunks?: number;
  perConvoChars?: number;
  model?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

function truncateConvos(convos: RawConversation[], perConvoChars: number): RawConversation[] {
  return convos.map((c) => {
    let used = 0;
    const messages = [];
    for (const m of c.messages) {
      if (used >= perConvoChars) break;
      const text = m.text.slice(0, Math.max(0, perConvoChars - used));
      used += text.length;
      if (text) messages.push({ ...m, text });
    }
    return { ...c, messages };
  });
}

export async function extractEvidence(convos: RawConversation[], caller: ModelCaller, opts: ExtractOpts = {}): Promise<EvidenceUnit[]> {
  const prepared = opts.perConvoChars ? truncateConvos(convos, opts.perConvoChars) : convos;
  let chunks = chunkConversations(prepared, opts.maxChars ?? 8000);
  if (opts.maxChunks && chunks.length > opts.maxChunks) chunks = chunks.slice(0, opts.maxChunks);

  // Two passes per chunk: a general sweep, then a reaction-focused one (corrections, pushback,
  // verification — the evidence the general pass reliably under-samples). Unioned + deduped below,
  // this is what keeps thin dimensions from flapping between runs on one missed quote.
  const tasks = chunks.flatMap((chunk) => [
    { chunk, prompt: evidencePrompt(chunk) },
    { chunk, prompt: evidenceReactionPrompt(chunk) },
  ]);

  opts.onProgress?.(0, tasks.length);
  let completed = 0;
  let dropped = 0;

  const perChunk = await mapLimit(tasks, opts.concurrency ?? 4, async ({ chunk, prompt }) => {
    const units: Array<Omit<RawEvidence, 'conversationLabel'> & { conversationId: string }> = [];
    try {
      const raw = parseJsonResponse(await caller.complete(prompt, { model: opts.model }));
      if (Array.isArray(raw)) {
        const byLabel = new Map<number, RawConversation>();
        chunk.forEach((c, i) => byLabel.set(i + 1, c));
        for (const r of raw as RawEvidence[]) {
          const label = parseInt(String(r?.conversationLabel ?? '').match(/\d+/)?.[0] ?? '', 10);
          const convo = byLabel.get(label);
          if (!convo) continue;
          // Verify the quote against the (truncated) conversation the model actually saw.
          const convoText = convo.messages.map((m) => m.text).join(' ');
          if (!quoteAppearsIn(r.quote, convoText)) { dropped++; continue; }
          units.push({
            conversationId: convo.id,
            timestamp: (typeof r.timestamp === 'string' && r.timestamp) ? r.timestamp : convo.createdAt,
            type: r.type, quote: r.quote, summary: r.summary,
          });
        }
      }
    } catch (e) {
      if (isRateLimitError(e)) throw e; // a usage cap won't clear by skipping — fail fast
      /* otherwise skip this chunk */
    }
    opts.onProgress?.(++completed, tasks.length);
    return units;
  });

  if (dropped > 0) console.warn(`[aibadges] dropped ${dropped} unverifiable quote(s)`);

  // Union the two passes: the reaction sweep re-finds moments the general pass also caught, so
  // collapse same-conversation near-identical quotes before assigning run-scoped ids.
  const deduped = dedupeMoments(perChunk.flat(), (u) => u.conversationId);

  const all: EvidenceUnit[] = [];
  let n = 0;
  for (const u of deduped) {
    const parsed = EvidenceUnitSchema.safeParse({
      id: `e${n + 1}`, timestamp: u.timestamp,
      sourceRef: { provider: 'claude' as const, conversationId: u.conversationId },
      type: u.type, quote: u.quote, summary: u.summary,
    });
    if (!parsed.success) continue;
    n += 1;
    all.push(parsed.data);
  }
  return all;
}
