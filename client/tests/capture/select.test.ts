import { describe, it, expect } from 'vitest';
import { selectAcrossTimeline } from '../../src/capture/select';

const conv = (id: string, day: number) => ({ id, updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z` });

describe('selectAcrossTimeline', () => {
  it('returns all (oldest->newest) when under the cap', () => {
    const out = selectAcrossTimeline([conv('b', 3), conv('a', 1), conv('c', 5)], 10);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the oldest and newest when sampling down', () => {
    const items = Array.from({ length: 20 }, (_, i) => conv(`c${i}`, i + 1)); // day 1..20
    const out = selectAcrossTimeline(items, 5);
    expect(out.length).toBe(5);
    expect(out[0].id).toBe('c0'); // oldest
    expect(out[out.length - 1].id).toBe('c19'); // newest
  });

  it('spreads the sample roughly evenly across the range', () => {
    const items = Array.from({ length: 100 }, (_, i) => conv(`c${i}`, ((i % 28) + 1)));
    // build a strictly increasing timeline so order is deterministic
    const timeline = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, updatedAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z` }));
    const out = selectAcrossTimeline(timeline, 10);
    expect(out.length).toBe(10);
    expect(out[0].id).toBe('c0');
    expect(out[9].id).toBe('c99');
    // monotonic, no dupes
    const idxs = out.map((c) => Number(c.id.slice(1)));
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
    expect(new Set(idxs).size).toBe(10);
  });

  it('handles edge counts', () => {
    expect(selectAcrossTimeline([], 5)).toEqual([]);
    const items = Array.from({ length: 5 }, (_, i) => conv(`c${i}`, i + 1));
    expect(selectAcrossTimeline(items, 0)).toEqual([]);
    expect(selectAcrossTimeline(items, 1).map((c) => c.id)).toEqual(['c4']); // newest
  });
});
