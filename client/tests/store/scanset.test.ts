import { describe, it, expect } from 'vitest';
import { loadScanSet, saveScanSet, partitionScanned, nextScanSet, scanKey } from '../../src/store/scanset';
import type { KV } from '../../src/store/types';

function memKv(seed: Record<string, string> = {}): KV & { store: Record<string, string> } {
  const store: Record<string, string> = { ...seed };
  return { store, async get(k) { return store[k] ?? null; }, async set(k, v) { store[k] = v; } };
}

describe('loadScanSet / saveScanSet', () => {
  it('round-trips per provider and tolerates corrupt or missing data', async () => {
    const kv = memKv();
    expect(await loadScanSet(kv, 'claude')).toEqual({});
    await saveScanSet(kv, 'claude', { 'uuid-A': '2026-01-01T00:00:00Z' });
    expect(await loadScanSet(kv, 'claude')).toEqual({ 'uuid-A': '2026-01-01T00:00:00Z' });
    expect(await loadScanSet(kv, 'chatgpt')).toEqual({}); // provider-scoped
    expect(await loadScanSet(memKv({ [scanKey('claude')]: 'not json' }), 'claude')).toEqual({});
    expect(await loadScanSet(memKv({ [scanKey('claude')]: JSON.stringify({ a: 1, b: 'ok' }) }), 'claude')).toEqual({});
  });

  it('discards a scan set written by an older extractor version (forces a full rescan)', async () => {
    const stale = memKv({ [scanKey('claude')]: JSON.stringify({ v: 1, entries: { 'uuid-A': 't1' } }) });
    expect(await loadScanSet(stale, 'claude')).toEqual({});
    // legacy unversioned flat shape is also discarded
    const flat = memKv({ [scanKey('claude')]: JSON.stringify({ 'uuid-A': 't1' }) });
    expect(await loadScanSet(flat, 'claude')).toEqual({});
  });
});

describe('partitionScanned', () => {
  const items = [
    { id: 'a', updatedAt: 't1' }, // unchanged
    { id: 'b', updatedAt: 't9' }, // changed since scan
    { id: 'c', updatedAt: 't3' }, // never scanned
  ];
  it('separates unchanged conversations from new/changed ones', () => {
    const { toScan, unchanged } = partitionScanned(items, { a: 't1', b: 't2' });
    expect(unchanged.map((i) => i.id)).toEqual(['a']);
    expect(toScan.map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('scans everything when the set is empty (first run)', () => {
    expect(partitionScanned(items, {}).toScan).toHaveLength(3);
  });
});

describe('nextScanSet', () => {
  const prev = { a: 't1', gone: 't1', evicted: 't1' };
  const validIds = new Set(['a', 'evicted', 'b']);
  it('keeps live entries, drops deleted conversations and pool-evicted ones, records new scans', () => {
    const next = nextScanSet(prev, [{ id: 'b', updatedAt: 't5' }], validIds, new Set(['evicted']));
    expect(next).toEqual({ a: 't1', b: 't5' });
  });
  it('a re-scanned conversation that was itself evicted stays out (must re-scan next run)', () => {
    const next = nextScanSet(prev, [{ id: 'b', updatedAt: 't5' }], validIds, new Set(['b']));
    expect(next.b).toBeUndefined();
  });
});
