import { describe, it, expect } from 'vitest';
import { dedupeMoments, mergePool, sameMoment, loadPool, savePool, poolKey, POOL_CAP, evictedConversations, type PoolUnit } from '../../src/engine/evidence-pool';
import type { KV } from '../../src/store/types';

function memKv(seed: Record<string, string> = {}): KV & { store: Record<string, string> } {
  const store: Record<string, string> = { ...seed };
  return { store, async get(k) { return store[k] ?? null; }, async set(k, v) { store[k] = v; } };
}

const unit = (over: Partial<PoolUnit> & { quote: string }): PoolUnit => ({
  timestamp: '2026-05-01T00:00:00Z',
  sourceRef: { provider: 'claude', conversationId: 'uuid-A' },
  type: 'decision',
  summary: 's',
  ...over,
});

describe('sameMoment / dedupeMoments', () => {
  it('collapses containment variants of the same quote, keeping the longer one', () => {
    const short = { conversationId: 'c1', quote: 'Seguro que toda la deuda', summary: 'a', type: 'decision' };
    const long = { conversationId: 'c1', quote: 'Seguro que toda la deuda está activa? La cantidad es menor', summary: 'b', type: 'decision' };
    expect(sameMoment(short, long)).toBe(true);
    const out = dedupeMoments([short, long], (u) => u.conversationId);
    expect(out).toHaveLength(1);
    expect(out[0].quote).toBe(long.quote);
  });

  it('is whitespace/case/curly-quote insensitive but conversation-scoped', () => {
    const a = { conversationId: 'c1', quote: 'App fiable aunque haya que pagar', summary: '', type: 'preference' };
    const b = { conversationId: 'c1', quote: 'app  fiable aunque haya que pagar', summary: '', type: 'preference' };
    const other = { conversationId: 'c2', quote: 'App fiable aunque haya que pagar', summary: '', type: 'preference' };
    expect(dedupeMoments([a, b, other], (u) => u.conversationId)).toHaveLength(2);
  });

  it('keeps the FIRST unit on exact ties (fresh-first callers prefer the fresh variant)', () => {
    const a = { conversationId: 'c1', quote: 'same quote here', summary: 'fresh', type: 'decision' };
    const b = { conversationId: 'c1', quote: 'same quote here', summary: 'prior', type: 'decision' };
    expect(dedupeMoments([a, b], (u) => u.conversationId)[0].summary).toBe('fresh');
  });
});

describe('mergePool', () => {
  it('unions prior and fresh, deduped, in chronological order', () => {
    const prior = [unit({ quote: 'old moment', timestamp: '2026-01-01T00:00:00Z' })];
    const fresh = [
      unit({ quote: 'new moment', timestamp: '2026-06-01T00:00:00Z' }),
      unit({ quote: 'old moment', timestamp: '2026-01-01T00:00:00Z' }), // re-found: no dupe
    ];
    const merged = mergePool(prior, fresh);
    expect(merged.map((u) => u.quote)).toEqual(['old moment', 'new moment']);
  });

  it('caps by evicting the OLDEST overflow', () => {
    const many = Array.from({ length: POOL_CAP + 10 }, (_, i) =>
      unit({ quote: `moment number ${i} with enough words`, timestamp: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    const merged = mergePool([], many);
    expect(merged).toHaveLength(POOL_CAP);
    expect(merged[0].quote).toBe('moment number 10 with enough words'); // 0..9 evicted
  });
});

describe('evictedConversations', () => {
  it('reports conversations that lost ALL units to eviction, not ones that kept some', () => {
    const a1 = unit({ quote: 'first moment in convo A', sourceRef: { provider: 'claude', conversationId: 'A' } });
    const a2 = unit({ quote: 'second moment in convo A', sourceRef: { provider: 'claude', conversationId: 'A' } });
    const b = unit({ quote: 'only moment in convo B', sourceRef: { provider: 'claude', conversationId: 'B' } });
    expect(evictedConversations([a1, a2, b], [a2])).toEqual(new Set(['B']));
    expect(evictedConversations([a1, b], [a1, b])).toEqual(new Set());
  });
});

describe('loadPool / savePool', () => {
  it('round-trips per provider and tolerates corrupt or missing data', async () => {
    const kv = memKv();
    expect(await loadPool(kv, 'claude')).toEqual([]);
    const units = [unit({ quote: 'a verified moment' })];
    await savePool(kv, 'claude', units);
    expect(await loadPool(kv, 'claude')).toEqual(units);
    expect(await loadPool(kv, 'chatgpt')).toEqual([]); // provider-scoped
    const bad = memKv({ [poolKey('claude')]: 'not json' });
    expect(await loadPool(bad, 'claude')).toEqual([]);
    const wrongShape = memKv({ [poolKey('claude')]: JSON.stringify([{ nope: 1 }, unit({ quote: 'kept' })]) });
    expect((await loadPool(wrongShape, 'claude')).map((u) => u.quote)).toEqual(['kept']);
  });
});
