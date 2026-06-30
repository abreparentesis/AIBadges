import { describe, it, expect } from 'vitest';
import { ProfileStore } from '../../src/store/local';
import type { KV } from '../../src/store/types';
import type { Profile, EvidenceUnit } from '../../src/engine/types';

function memKv(): KV {
  const m = new Map<string, string>();
  return { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
}

const evidence: EvidenceUnit[] = [{ id: 'c1:0', timestamp: '2026-01-01T00:00:00Z',
  sourceRef: { provider: 'claude', conversationId: 'c1' }, type: 'decision', quote: 'q', summary: 's' }];

function profileV(v: number): Profile {
  return { version: v, computedAt: '2026-06-05T00:00:00Z', modelProvenance: 'm',
    sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 1 },
    thinking: [], capability: { aiFluency: {
      delegation: { band: 'emerging', evidenceIds: [] }, description: { band: 'emerging', evidenceIds: [] },
      discernment: { band: 'emerging', evidenceIds: [] }, diligence: { band: 'emerging', evidenceIds: [] } },
      yeggeStage: { stage: 1, evidenceIds: [] }, domains: [] },
    trajectory: { window: { earlyTo: 'x', recentFrom: 'x' }, shifts: [] } };
}

describe('ProfileStore', () => {
  it('round-trips evidence', async () => {
    const s = new ProfileStore(memKv());
    await s.saveEvidence(evidence);
    expect(await s.loadEvidence()).toEqual(evidence);
  });
  it('tracks the latest profile version', async () => {
    const s = new ProfileStore(memKv());
    expect(await s.latestVersion()).toBe(0);
    await s.saveProfileVersion(profileV(1));
    await s.saveProfileVersion(profileV(2));
    expect(await s.latestVersion()).toBe(2);
    expect((await s.loadProfile(1))?.version).toBe(1);
  });
});
