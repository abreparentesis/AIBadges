import { describe, it, expect } from 'vitest';
import { ProfileSchema, EvidenceUnitSchema } from '../../src/engine/types';

describe('ProfileSchema capability is optional', () => {
  const baseProfile = {
    version: 1, computedAt: '2026-06-07T00:00:00Z', modelProvenance: 'm',
    sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 3 },
    thinking: [], trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [] },
  };
  it('parses a profile with no capability (post-pivot)', () => {
    expect(ProfileSchema.safeParse(baseProfile).success).toBe(true);
  });
  it('still parses an old profile that includes capability', () => {
    const withCap = { ...baseProfile, capability: {
      aiFluency: { delegation: { band: 'emerging', evidenceIds: [] }, description: { band: 'emerging', evidenceIds: [] }, discernment: { band: 'emerging', evidenceIds: [] }, diligence: { band: 'emerging', evidenceIds: [] } },
      yeggeStage: { stage: 1, evidenceIds: [] }, domains: [],
    } };
    expect(ProfileSchema.safeParse(withCap).success).toBe(true);
  });
});

describe('schemas', () => {
  it('rejects an evidence unit missing a quote', () => {
    const bad = { id: 'c1:0', timestamp: '2026-01-01T00:00:00Z',
      sourceRef: { provider: 'claude', conversationId: 'c1' }, type: 'decision', summary: 's' };
    expect(EvidenceUnitSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a minimal valid profile', () => {
    const p = {
      version: 1, computedAt: '2026-06-05T00:00:00Z', modelProvenance: 'claude-in-session',
      sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 3 },
      thinking: [{ claim: 'Decomposes problems top-down', evidenceIds: ['c1:0'], confidence: 'high' }],
      capability: {
        aiFluency: {
          delegation: { band: 'proficient', evidenceIds: ['c1:0'] },
          description: { band: 'advanced', evidenceIds: [] },
          discernment: { band: 'developing', evidenceIds: [] },
          diligence: { band: 'proficient', evidenceIds: [] },
        },
        yeggeStage: { stage: 4, evidenceIds: [] },
        domains: [{ name: 'backend', band: 'advanced', evidenceIds: [] }],
      },
      trajectory: { window: { earlyTo: '2026-02-01T00:00:00Z', recentFrom: '2026-05-01T00:00:00Z' }, shifts: [] },
    };
    expect(ProfileSchema.safeParse(p).success).toBe(true);
  });
});
