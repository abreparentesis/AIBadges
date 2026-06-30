import { describe, it, expect } from 'vitest';
import { assembleProfile, type ProfileParts } from '../../src/engine/assemble';
import { ProfileSchema, type EvidenceUnit } from '../../src/engine/types';

const ev = (id: string, conversationId: string): EvidenceUnit => ({
  id, timestamp: '2026-01-01T00:00:00Z', type: 'decision', quote: `q-${id}`, summary: `s-${id}`,
  sourceRef: { provider: 'chatgpt', conversationId },
});
const opts = {
  version: 3, now: '2026-06-08T00:00:00Z', modelProvenance: 'test',
  sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 2 },
};
const emptyTraj = { window: { earlyTo: '', recentFrom: '' }, shifts: [] as ProfileParts['trajectory']['shifts'] };

describe('assembleProfile', () => {
  it('produces a schema-valid profile and grades confidence by evidence weight', () => {
    const parts: ProfileParts = {
      evidence: [ev('e1', 'c1'), ev('e2', 'c1'), ev('e3', 'c2')],
      thinking: [
        { claim: 'across 2 convos', evidenceIds: ['e1', 'e2', 'e3'], confidence: 'low' }, // 3 ids / 2 convos -> high
        { claim: 'same convo twice', evidenceIds: ['e1', 'e2'], confidence: 'high' },      // 2 ids / 1 convo -> medium
        { claim: 'single', evidenceIds: ['e3'], confidence: 'high' },                      // 1 id -> low
      ],
      trajectory: emptyTraj,
    };
    const p = assembleProfile(parts, opts);
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(p.thinking.find((c) => c.claim === 'across 2 convos')!.confidence).toBe('high');
    expect(p.thinking.find((c) => c.claim === 'same convo twice')!.confidence).toBe('medium');
    expect(p.thinking.find((c) => c.claim === 'single')!.confidence).toBe('low');
  });

  it('drops claims and shifts whose evidence ids are all unknown, dedupes repeats', () => {
    const parts: ProfileParts = {
      evidence: [ev('e1', 'c1')],
      thinking: [
        { claim: 'real', evidenceIds: ['e1', 'e1', 'ghost'], confidence: 'low' }, // dedupes to [e1]
        { claim: 'ghost only', evidenceIds: ['ghost'], confidence: 'high' },       // dropped
      ],
      trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [
        { dimension: 'd', direction: 'rising', velocity: 'fast', evidenceIds: ['nope'] }, // dropped
      ] },
    };
    const p = assembleProfile(parts, opts);
    expect(p.thinking).toHaveLength(1);
    expect(p.thinking[0].evidenceIds).toEqual(['e1']);
    expect(p.trajectory.shifts).toHaveLength(0);
    expect(p.evidence!.map((e) => e.id)).toEqual(['e1']); // only referenced evidence retained
  });

  it('neutralizes unbacked type axes to lean 50 and drops type when no axis is backed', () => {
    const mkType = (eiIds: string[]) => ({
      code: 'INTJ', summary: 's', confidence: 'high' as const,
      axes: {
        EI: { letter: 'I', lean: 80, evidenceIds: eiIds },
        SN: { letter: 'N', lean: 70, evidenceIds: [] },
        TF: { letter: 'T', lean: 90, evidenceIds: [] },
        JP: { letter: 'J', lean: 60, evidenceIds: [] },
      },
    });
    const backed = assembleProfile({ evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj, type: mkType(['e1']) }, opts);
    expect(backed.type!.axes.SN.lean).toBe(50); // unbacked axis neutralized
    expect(backed.type!.axes.EI.lean).toBe(80); // backed axis kept

    const none = assembleProfile({ evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj, type: mkType([]) }, opts);
    expect(none.type).toBeUndefined(); // no backed axis -> whole type dropped
  });
});
