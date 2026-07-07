import type { KV } from '../store/types';
import type { Provider } from '../store/provider';
import type { EvidenceUnit } from './types';

/**
 * Persistent, per-provider pool of verified evidence units — the memory that makes scores stable
 * across runs. A band is hard-capped by its surviving quotes, so a re-run that fails to re-find one
 * borderline quote used to drop a whole band (±5 points). Every run now merges its freshly
 * extracted units with this pool before synthesis, so evidence accumulates instead of being
 * re-rolled.
 *
 * PRIVACY: pool units contain verbatim quotes. They live ONLY in local storage (same as the stored
 * profile's evidence) and must never be synced — pushProfile strips evidence, and nothing else may
 * send this key's contents anywhere.
 */

/** A pool unit is an EvidenceUnit without the run-scoped id — ids are reassigned every run. */
export type PoolUnit = Omit<EvidenceUnit, 'id'>;

export const POOL_CAP = 200; // keeps the synthesis prompt bounded; evicts oldest first
export const poolKey = (provider: Provider): string => `aibadges:evidencePool:${provider}`;

const normQuote = (q: string): string =>
  q.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Same behavioral moment = same conversation + (near-)same quote. Containment (not equality)
 * because different runs quote more or less of the same line; the longer variant wins.
 */
export function sameMoment(a: { quote: string }, b: { quote: string }): boolean {
  const qa = normQuote(a.quote); const qb = normQuote(b.quote);
  if (!qa || !qb) return false;
  return qa.includes(qb) || qb.includes(qa);
}

/**
 * Dedupe units that describe the same moment, keeping the longer quote. Generic over the unit
 * shape so both the Claude engine (EvidenceUnit) and the ChatGPT autorun (RawUnit) can use it;
 * `convoOf` supplies the conversation identity to scope the quote comparison.
 */
export function dedupeMoments<T extends { quote: string }>(units: T[], convoOf: (u: T) => string): T[] {
  const out: T[] = [];
  for (const u of units) {
    if (!normQuote(u.quote)) continue;
    const i = out.findIndex((o) => convoOf(o) === convoOf(u) && sameMoment(o, u));
    if (i === -1) out.push(u);
    else if (normQuote(u.quote).length > normQuote(out[i].quote).length) out[i] = u;
  }
  return out;
}

/**
 * Merge prior pool units with a run's fresh units: dedupe by moment, order chronologically
 * (the synthesis prompts promise oldest-to-newest evidence), cap by evicting the OLDEST overflow
 * so the pool tracks the person's recent history as it grows.
 */
export function mergePool(prior: PoolUnit[], fresh: PoolUnit[], cap = POOL_CAP): PoolUnit[] {
  const merged = dedupeMoments([...prior, ...fresh], (u) => u.sourceRef.conversationId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/**
 * Conversations that lost ALL their units to the merge's cap eviction. Their scan-set entries
 * must be dropped so the next run re-scans them — a "scanned" conversation with no pooled
 * evidence would otherwise become a permanent blind spot.
 */
export function evictedConversations(before: PoolUnit[], after: PoolUnit[]): Set<string> {
  const kept = new Set(after.map((u) => u.sourceRef.conversationId));
  return new Set(before.map((u) => u.sourceRef.conversationId).filter((id) => !kept.has(id)));
}

const isPoolUnit = (u: unknown): u is PoolUnit => {
  const o = u as PoolUnit | null;
  return !!o && typeof o === 'object' && typeof o.quote === 'string' && !!o.quote
    && typeof o.timestamp === 'string' && !!o.sourceRef && typeof o.sourceRef.conversationId === 'string';
};

export async function loadPool(kv: KV, provider: Provider): Promise<PoolUnit[]> {
  try {
    const raw = await kv.get(poolKey(provider));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isPoolUnit) : [];
  } catch { return []; }
}

export async function savePool(kv: KV, provider: Provider, units: PoolUnit[]): Promise<void> {
  await kv.set(poolKey(provider), JSON.stringify(units.slice(-POOL_CAP)));
}
