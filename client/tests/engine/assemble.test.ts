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

  it('anchors capability: caps each band by surviving evidence weight, drops unbacked domains, retains referenced evidence', () => {
    const capability = {
      aiFluency: {
        delegation: { band: 'proficient' as const, evidenceIds: ['e1', 'ghost'] }, // 1 real quote -> capped to developing
        description: { band: 'advanced' as const, evidenceIds: ['ghost'] },         // 0 real quotes -> capped to emerging
        discernment: { band: 'developing' as const, evidenceIds: [] },              // 0 real quotes -> capped to emerging
        diligence: { band: 'emerging' as const, evidenceIds: ['e1'] },              // already lowest -> stays emerging
      },
      yeggeStage: { stage: 4, evidenceIds: ['e1', 'ghost'] },
      domains: [
        { name: 'backed domain', band: 'advanced' as const, evidenceIds: ['e1'] },
        { name: 'unbacked domain', band: 'advanced' as const, evidenceIds: ['ghost'] },
      ],
    };
    const p = assembleProfile(
      { evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj, capability },
      opts,
    );
    expect(p.capability).toBeDefined();
    // a band can never exceed its surviving evidence
    expect(p.capability!.aiFluency.description.band).toBe('emerging');   // asserted 'advanced' on 0 quotes
    expect(p.capability!.aiFluency.description.evidenceIds).toEqual([]);
    expect(p.capability!.aiFluency.discernment.band).toBe('emerging');   // 'developing' on 0 quotes
    expect(p.capability!.aiFluency.delegation.band).toBe('developing');  // 'proficient' capped by 1 quote
    expect(p.capability!.aiFluency.delegation.evidenceIds).toEqual(['e1']);
    expect(p.capability!.aiFluency.diligence.band).toBe('emerging');
    expect(p.capability!.yeggeStage.stage).toBe(2); // derived from the capped bands (developing + emerging x3)
    expect(p.capability!.yeggeStage.evidenceIds).toEqual(['e1']); // union of the dimensions' surviving ids
    // domain with no surviving evidence is dropped; backed domain survives
    expect(p.capability!.domains).toHaveLength(1);
    expect(p.capability!.domains[0].name).toBe('backed domain');
    expect(p.evidence!.map((e) => e.id)).toEqual(['e1']);
  });

  it('keeps a high band when the evidence weight supports it', () => {
    const capability = {
      aiFluency: {
        delegation: { band: 'advanced' as const, note: 'consistently hands off whole jobs', evidenceIds: ['e1', 'e2', 'e3'] }, // 3 ids / 2 convos -> advanced allowed
        description: { band: 'advanced' as const, evidenceIds: ['e1', 'e2'] },        // 2 ids -> capped to proficient
        discernment: { band: 'emerging' as const, evidenceIds: [] },
        diligence: { band: 'emerging' as const, evidenceIds: [] },
      },
      yeggeStage: { stage: 8, evidenceIds: ['e1'] }, // chat source -> capped to 6 (no Orchestrator)
      domains: [],
    };
    const p = assembleProfile(
      { evidence: [ev('e1', 'c1'), ev('e2', 'c2'), ev('e3', 'c1')], thinking: [], trajectory: emptyTraj, capability },
      opts,
    );
    expect(p.capability!.aiFluency.delegation.band).toBe('advanced');
    expect(p.capability!.aiFluency.delegation.note).toBe('consistently hands off whole jobs'); // rationale carried through
    expect(p.capability!.aiFluency.description.band).toBe('proficient');
    expect(p.capability!.yeggeStage.stage).toBe(3); // derived from bands (advanced+proficient+emerging+emerging); maxes at 6, never Orchestrator
  });

  it('omits capability entirely when parts.capability was not provided', () => {
    const p = assembleProfile({ evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj }, opts);
    expect(p.capability).toBeUndefined();
  });
});
