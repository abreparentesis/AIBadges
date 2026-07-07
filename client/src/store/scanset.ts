import type { KV } from './types';
import type { Provider } from './provider';

/**
 * Which conversations a past run has already extracted, and at what version — the bookkeeping
 * behind incremental extraction. A conversation whose list-API `updatedAt` still matches its
 * recorded fingerprint is already represented in the evidence pool and is neither re-fetched nor
 * re-extracted; a new or changed conversation is. The expensive step of a run is the model turns,
 * so an unchanged history skips straight to synthesis.
 */
export type ScanSet = Record<string, string>; // conversationId -> updatedAt fingerprint at scan time

export const scanKey = (provider: Provider): string => `aibadges:scanned:${provider}`;

export async function loadScanSet(kv: KV, provider: Provider): Promise<ScanSet> {
  try {
    const raw = await kv.get(scanKey(provider));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: ScanSet = {};
    for (const [id, fp] of Object.entries(obj)) if (typeof fp === 'string') out[id] = fp;
    return out;
  } catch { return {}; }
}

export async function saveScanSet(kv: KV, provider: Provider, set: ScanSet): Promise<void> {
  await kv.set(scanKey(provider), JSON.stringify(set));
}

/** Split a selection into conversations that need (re)scanning vs ones the pool already represents. */
export function partitionScanned<T extends { id: string; updatedAt: string }>(
  items: T[], scanned: ScanSet,
): { toScan: T[]; unchanged: T[] } {
  const toScan: T[] = []; const unchanged: T[] = [];
  for (const it of items) (scanned[it.id] === it.updatedAt ? unchanged : toScan).push(it);
  return { toScan, unchanged };
}

/**
 * The scan set after a successful run: prior entries survive only if their conversation still
 * exists on the provider (deleted chats fall out) AND wasn't evicted from the evidence pool
 * (an evicted conversation must be re-scanned next run — "scanned" promises "represented");
 * this run's scans are then recorded at their current fingerprint.
 */
export function nextScanSet(
  prev: ScanSet,
  scannedNow: Array<{ id: string; updatedAt: string }>,
  validIds: Set<string>,
  evictedIds: Set<string>,
): ScanSet {
  const next: ScanSet = {};
  for (const [id, fp] of Object.entries(prev)) if (validIds.has(id) && !evictedIds.has(id)) next[id] = fp;
  for (const c of scannedNow) {
    if (evictedIds.has(c.id)) delete next[c.id];
    else next[c.id] = c.updatedAt;
  }
  return next;
}
