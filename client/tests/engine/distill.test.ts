import { describe, it, expect } from 'vitest';
import { distill, PROVENANCE_LABEL } from '../../src/engine/distill';
import { SignalSchema, type Profile } from '../../src/engine/types';

const profile: Profile = {
  version: 2, computedAt: '2026-06-05T00:00:00Z', modelProvenance: 'claude-in-session',
  sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 5 },
  thinking: [{ claim: 'Decomposes before acting', evidenceIds: ['c1:0'], confidence: 'high' }],
  trajectory: { window: { earlyTo: '2026-02-01T00:00:00Z', recentFrom: '2026-05-01T00:00:00Z' },
    shifts: [{ dimension: 'verification discipline', direction: 'rising', velocity: 'moderate', evidenceIds: [] }] },
};

describe('distill', () => {
  it('produces private, schema-valid signals carrying the provenance label', () => {
    const signals = distill(profile, '2026-06-05T00:00:00Z');
    expect(signals.map(s => s.type).sort()).toEqual(['identityCard', 'trajectorySnippet']);
    for (const s of signals) {
      expect(SignalSchema.safeParse(s).success).toBe(true);
      expect(s.disclosure).toBe('private');
      expect(s.fromProfileVersion).toBe(2);
      expect(s.provenanceLabel).toBe(PROVENANCE_LABEL);
    }
  });

  it('identityCard carries every thinking claim with its confidence', () => {
    const card = distill(profile, '2026-06-05T00:00:00Z').find((s) => s.type === 'identityCard')!;
    const c = card.surfacedContent as Record<string, any>;
    expect(c.headline).toBe('Decomposes before acting');
    expect(c.thinking).toEqual([{ claim: 'Decomposes before acting', confidence: 'high' }]);
    expect(c.traits).toBeUndefined();
  });

  it('adds a typeCard signal (with looked-up name/group) when the profile has a type', () => {
    const withType: Profile = {
      ...profile,
      type: {
        code: 'INTJ', summary: 'Strategic and systematic.', confidence: 'high',
        axes: {
          EI: { letter: 'I', lean: 70, evidenceIds: [] }, SN: { letter: 'N', lean: 65, evidenceIds: [] },
          TF: { letter: 'T', lean: 80, evidenceIds: [] }, JP: { letter: 'J', lean: 60, evidenceIds: [] },
        },
      },
    };
    const card = distill(withType, '2026-06-05T00:00:00Z').find((s) => s.type === 'typeCard');
    expect(card).toBeTruthy();
    expect(SignalSchema.safeParse(card).success).toBe(true);
    const c = card!.surfacedContent as Record<string, unknown>;
    expect(c.code).toBe('INTJ');
    expect(c.name).toBe('The Strategist');
    expect(c.group).toBe('Analysts');
  });

  it('no longer emits a statBadge signal', () => {
    expect(distill(profile, '2026-06-05T00:00:00Z').some((s) => s.type === 'statBadge')).toBe(false);
  });

  it('typeCard carries the axes so the share card can show stat bars', () => {
    const withType = { ...profile, type: {
      code: 'INTJ', summary: 'Strategic.', confidence: 'high',
      axes: { EI: { letter: 'I', lean: 70, evidenceIds: [] }, SN: { letter: 'N', lean: 65, evidenceIds: [] }, TF: { letter: 'T', lean: 80, evidenceIds: [] }, JP: { letter: 'J', lean: 60, evidenceIds: [] } },
    } };
    const card = distill(withType, '2026-06-05T00:00:00Z').find((s) => s.type === 'typeCard')!;
    const c = card.surfacedContent as Record<string, any>;
    expect(c.axes.TF.letter).toBe('T');
    expect(c.axes.EI.lean).toBe(70);
  });
});
