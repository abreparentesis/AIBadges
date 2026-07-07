import { describe, it, expect } from 'vitest';
import { assembleProfile, type ProfileParts } from '../../src/engine/assemble';
import { ProfileSchema, type EvidenceUnit } from '../../src/engine/types';

// Quotes are deliberately >= 24 chars: the capability substance gate drops fragments, so short
// placeholder quotes would be filtered out of every band.
const ev = (id: string, conversationId: string): EvidenceUnit => ({
  id, timestamp: '2026-01-01T00:00:00Z', type: 'decision', quote: `substantive evidence quote ${id} of ample length`, summary: `s-${id}`,
  sourceRef: { provider: 'chatgpt', conversationId },
});
const evShort = (id: string, conversationId: string, quote: string): EvidenceUnit => ({
  id, timestamp: '2026-01-01T00:00:00Z', type: 'decision', quote, summary: `s-${id}`,
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

  it('flags thin histories as provisional coverage (the PRISM floor-effect lesson)', () => {
    const parts: ProfileParts = {
      evidence: [ev('e1', 'c1'), ev('e2', 'c2')],
      thinking: [{ claim: 'a claim', evidenceIds: ['e1', 'e2'], confidence: 'low' }],
      trajectory: emptyTraj,
    };
    // 5 conversations in the window -> provisional regardless of evidence spread
    const thin = assembleProfile(parts, { ...opts, sourceWindow: { ...opts.sourceWindow, conversationCount: 5 } });
    expect(thin.coverage).toEqual({ provisional: true, conversationCount: 5, evidenceConversations: 2 });

    // 25 conversations but surviving evidence spans only 2 -> still provisional
    const narrow = assembleProfile(parts, { ...opts, sourceWindow: { ...opts.sourceWindow, conversationCount: 25 } });
    expect(narrow.coverage?.provisional).toBe(true);
    expect(narrow.coverage?.evidenceConversations).toBe(2);

    // 25 conversations with evidence across 5 distinct conversations -> adequate
    const wideParts: ProfileParts = {
      evidence: ['c1', 'c2', 'c3', 'c4', 'c5'].map((c, i) => ev(`e${i + 1}`, c)),
      thinking: [{ claim: 'broad claim', evidenceIds: ['e1', 'e2', 'e3', 'e4', 'e5'], confidence: 'low' }],
      trajectory: emptyTraj,
    };
    const wide = assembleProfile(wideParts, { ...opts, sourceWindow: { ...opts.sourceWindow, conversationCount: 25 } });
    expect(wide.coverage).toEqual({ provisional: false, conversationCount: 25, evidenceConversations: 5 });

    // schema round-trips the field, and old profiles without it still parse
    expect(ProfileSchema.parse(wide).coverage?.provisional).toBe(false);
    const legacy = { ...wide };
    delete (legacy as Record<string, unknown>).coverage;
    expect(ProfileSchema.parse(legacy).coverage).toBeUndefined();
  });

  it('derives the Yegge stage from the capped bands and ignores the model-provided stage entirely', () => {
    // Decision record (WildChat calibration pilot, 2026-07-07): the model/audit step may emit
    // its own yeggeStage, but the assembler's derivation wins by design — the derived stage is
    // anchored to the audited, evidence-capped bands, while a model-emitted stage is an
    // unanchored scalar. Bands (developing x3 + emerging) -> avg 1.75 -> round(1.75/4*6) = 3,
    // regardless of whether the model claimed stage 1 or stage 8.
    const mkCap = (stage: number) => ({
      aiFluency: {
        delegation: { band: 'developing' as const, evidenceIds: ['e1'] },
        description: { band: 'developing' as const, evidenceIds: ['e1'] },
        discernment: { band: 'developing' as const, evidenceIds: ['e1'] },
        diligence: { band: 'emerging' as const, evidenceIds: ['e1'] },
      },
      yeggeStage: { stage, evidenceIds: ['e1'] },
      domains: [],
    });
    const run = (stage: number) =>
      assembleProfile(
        { evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj, capability: mkCap(stage) },
        opts,
      ).capability!.yeggeStage.stage;
    expect(run(1)).toBe(3);
    expect(run(8)).toBe(3);
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

  it('drops sub-24-char fragment quotes from a fluency band (no padding with junk)', () => {
    const capability = {
      aiFluency: {
        delegation: { band: 'advanced' as const, evidenceIds: ['g1', 'g2', 'g3', 'frag'] }, // frag is a fragment
        description: { band: 'emerging' as const, evidenceIds: [] },
        discernment: { band: 'proficient' as const, evidenceIds: ['frag', 'frag2'] }, // ONLY fragments
        diligence: { band: 'emerging' as const, evidenceIds: [] },
      },
      yeggeStage: { stage: 6, evidenceIds: [] },
      domains: [],
    };
    const p = assembleProfile(
      {
        evidence: [ev('g1', 'c1'), ev('g2', 'c2'), ev('g3', 'c1'), evShort('frag', 'c1', 'De la marca grow'), evShort('frag2', 'c2', 'Validar')],
        thinking: [], trajectory: emptyTraj, capability,
      },
      opts,
    );
    // The fragment is gone from delegation; the 3 substantive quotes keep it advanced.
    expect(p.capability!.aiFluency.delegation.evidenceIds).toEqual(['g1', 'g2', 'g3']);
    expect(p.capability!.aiFluency.delegation.band).toBe('advanced');
    // Discernment was backed ONLY by fragments -> nothing survives -> emerging.
    expect(p.capability!.aiFluency.discernment.evidenceIds).toEqual([]);
    expect(p.capability!.aiFluency.discernment.band).toBe('emerging');
  });

  it('omits capability entirely when parts.capability was not provided', () => {
    const p = assembleProfile({ evidence: [ev('e1', 'c1')], thinking: [], trajectory: emptyTraj }, opts);
    expect(p.capability).toBeUndefined();
  });
});
