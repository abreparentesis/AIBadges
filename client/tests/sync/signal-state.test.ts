import { describe, it, expect } from 'vitest';
import { carryOverSharing } from '../../src/sync/signal-state';
import type { Signal } from '../../src/engine/types';

const fresh = (over: Partial<Signal> = {}): Signal => ({
  id: 'sig-stat-2', type: 'statBadge', fromProfileVersion: 2,
  surfacedContent: { fluencyScore: 65 }, disclosure: 'private',
  provenanceLabel: 'p', createdAt: '2026-07-07T00:00:00Z',
  ...over,
});

describe('carryOverSharing', () => {
  it('keeps a published badge public and carries its shareToken across a re-run', () => {
    const prev = JSON.stringify([{ ...fresh({ fromProfileVersion: 1, surfacedContent: { fluencyScore: 40 } }), disclosure: 'public', shareToken: 'tok-abc' }]);
    const [out] = carryOverSharing(prev, [fresh()]);
    expect(out.disclosure).toBe('public');
    expect(out.shareToken).toBe('tok-abc');
    expect(out.surfacedContent).toEqual({ fluencyScore: 65 }); // content is the NEW run's
  });

  it('leaves a private badge private and never invents a token', () => {
    const prev = JSON.stringify([{ ...fresh(), disclosure: 'private', shareToken: null }]);
    const [out] = carryOverSharing(prev, [fresh()]);
    expect(out.disclosure).toBe('private');
    expect((out as { shareToken?: string | null }).shareToken).toBeUndefined();
  });

  it('tolerates missing or corrupt previous state (first run)', () => {
    expect(carryOverSharing(null, [fresh()])[0].disclosure).toBe('private');
    expect(carryOverSharing('not json', [fresh()])[0].disclosure).toBe('private');
    expect(carryOverSharing('{}', [fresh()])[0].disclosure).toBe('private');
  });

  it('matches by type, so an unrelated published signal does not leak onto the badge', () => {
    const prev = JSON.stringify([{ ...fresh({ type: 'identityCard', id: 'sig-id-1' }), disclosure: 'public', shareToken: 'tok-id' }]);
    const [out] = carryOverSharing(prev, [fresh()]);
    expect(out.disclosure).toBe('private');
  });
});
