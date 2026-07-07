import { describe, it, expect } from 'vitest';
import { profileFromGptOutput, GptImportError } from '../../src/engine/chatgpt-import';
import { BackendSync } from '../../src/sync/backend';
import type { CaptureBundle } from '../../src/capture/chatgpt-export';

const bundle: CaptureBundle = {
  capturedAt: '2026-06-08T00:00:00Z',
  idMap: { c1: 'uuid-A', c2: 'uuid-B' },
  export: {
    version: 1, instructionsFor: 'aibadges-gpt',
    conversations: [
      { conversationId: 'c1', title: 't1', createdAt: '2026-01-01T00:00:00Z', messages: [{ role: 'user', text: 'hi' }] },
      { conversationId: 'c2', title: 't2', createdAt: '2026-05-01T00:00:00Z', messages: [{ role: 'user', text: 'yo' }] },
    ],
  },
};
// Legacy personality-shaped fixtures below predate fluency-only mode; pin them to the old behavior.
const opts = { version: 4, now: '2026-06-08T00:00:00Z', fluencyOnly: false };

const goodOutput = {
  thinking: [
    { claim: 'Decomposes problems before acting', evidenceIds: ['e1', 'e2', 'e3'], confidence: 'low' },
    { claim: 'Hallucinated trait', evidenceIds: ['ghost'], confidence: 'high' },
  ],
  trajectory: { shifts: [{ dimension: 'rigor', direction: 'rising', velocity: 'moderate', evidenceIds: ['e1'] }] },
  type: {
    code: 'intj', summary: 'Analytical and planful.', confidence: 'medium',
    axes: {
      EI: { letter: 'I', lean: 70, evidenceIds: ['e1'] },
      SN: { letter: 'N', lean: 65, evidenceIds: [] },
      TF: { letter: 'T', lean: 80, evidenceIds: ['e2'] },
      JP: { letter: 'J', lean: 60, evidenceIds: [] },
    },
  },
  evidence: [
    { id: 'e1', quote: 'List the seams first', summary: 'plans decomposition', type: 'reasoning_move', conversationId: 'c1' },
    { id: 'e2', quote: 'Verify before fixing', summary: 'verifies', type: 'decision', conversationId: 'c2' },
    { id: 'e3', quote: 'Split the file', summary: 'splits', type: 'decision', conversationId: 'c1' },
  ],
};

describe('profileFromGptOutput', () => {
  it('maps a clean GPT reply to a schema-valid profile, joining timestamps + real ids by conversationId', () => {
    const p = profileFromGptOutput(JSON.stringify(goodOutput), bundle, opts);
    expect(p.version).toBe(4);
    expect(p.modelProvenance).toContain('chatgpt');
    expect(p.sourceWindow).toEqual({ fromDate: '2026-01-01T00:00:00Z', toDate: '2026-05-01T00:00:00Z', conversationCount: 2 });
    // type.code uppercased; type axes are backed by e1 (c1) + e2 (c2) only -> 2 ids -> medium
    expect(p.type!.code).toBe('INTJ');
    expect(p.type!.confidence).toBe('medium');
    expect(p.type!.axes.SN.lean).toBe(50); // unbacked axis neutralized
    // evidence resolved to real conversation ids + the export's createdAt timestamps
    const e1 = p.evidence!.find((e) => e.id === 'e1')!;
    expect(e1.sourceRef.conversationId).toBe('uuid-A');
    expect(e1.timestamp).toBe('2026-01-01T00:00:00Z');
    expect(p.evidence!.find((e) => e.id === 'e2')!.sourceRef.conversationId).toBe('uuid-B');
  });

  it('drops hallucinated claims whose evidence ids do not exist', () => {
    const p = profileFromGptOutput(JSON.stringify(goodOutput), bundle, opts);
    expect(p.thinking.map((c) => c.claim)).toContain('Decomposes problems before acting');
    expect(p.thinking.map((c) => c.claim)).not.toContain('Hallucinated trait');
  });

  it('parses JSON wrapped in markdown fences and prose', () => {
    const wrapped = "Here is your profile:\n```json\n" + JSON.stringify(goodOutput) + "\n```\nHope it helps!";
    const p = profileFromGptOutput(wrapped, bundle, opts);
    expect(p.thinking.length).toBeGreaterThan(0);
  });

  it('drops an invalid type code rather than throwing', () => {
    const bad = { ...goodOutput, type: { ...goodOutput.type, code: 'XYZ1' } };
    const p = profileFromGptOutput(JSON.stringify(bad), bundle, opts);
    expect(p.type).toBeUndefined();
    expect(p.thinking.length).toBeGreaterThan(0); // rest still imported
  });

  it('falls back to the window end date when evidence cites an unknown conversationId', () => {
    const out = {
      thinking: [{ claim: 'c', evidenceIds: ['e9'], confidence: 'low' }],
      evidence: [{ id: 'e9', quote: 'q', summary: 's', type: 'decision', conversationId: 'c999' }],
    };
    const p = profileFromGptOutput(JSON.stringify(out), bundle, opts);
    const e9 = p.evidence!.find((e) => e.id === 'e9')!;
    expect(e9.timestamp).toBe('2026-05-01T00:00:00Z'); // toDate fallback
    expect(e9.sourceRef.conversationId).toBe('c999');  // unknown id kept verbatim, not crashed
  });

  it('throws GptImportError on unparseable paste', () => {
    expect(() => profileFromGptOutput('not json at all', bundle, opts)).toThrow(GptImportError);
  });

  it('throws GptImportError when nothing is evidence-backed', () => {
    const out = { thinking: [{ claim: 'x', evidenceIds: ['ghost'], confidence: 'low' }], evidence: [] };
    expect(() => profileFromGptOutput(JSON.stringify(out), bundle, opts)).toThrow(GptImportError);
  });

  // REGRESSION: the fluency-only autorun produces capability + evidence and (deliberately) no
  // thinking/trajectory/type. The personality-era empty check discarded every such run.
  it('keeps a fluency-only reply (capability + evidence, no personality lenses)', () => {
    const out = {
      capability: {
        aiFluency: {
          delegation: { band: 'proficient', note: 'You hand off whole analyses.', nextStep: 'State the decision up front.', evidenceIds: ['e1'] },
          description: { band: 'proficient', note: 'You give goals plus constraints.', nextStep: 'Add your budget ceiling.', evidenceIds: ['e2'] },
          discernment: { band: 'developing', note: 'You sometimes push back.', nextStep: 'Challenge the weakest number.', evidenceIds: ['e3'] },
          diligence: { band: 'developing', note: 'You occasionally verify.', nextStep: 'Chase one citation yourself.', evidenceIds: ['e1'] },
        },
        yeggeStage: { stage: 4, evidenceIds: ['e1'] },
        domains: [],
      },
      evidence: goodOutput.evidence,
    };
    const p = profileFromGptOutput(JSON.stringify(out), bundle, { ...opts, fluencyOnly: true });
    expect(p.capability).toBeDefined();
    expect(p.capability!.fluencyScore).toBeGreaterThan(0);
    expect(p.thinking).toHaveLength(0);
  });

  it('throws GptImportError in fluency-only mode when the reply has no capability at all', () => {
    const out = { evidence: goodOutput.evidence };
    expect(() => profileFromGptOutput(JSON.stringify(out), bundle, { ...opts, fluencyOnly: true })).toThrow(GptImportError);
  });

  // Incremental extraction: the export holds only the re-scanned subset; the measured window is
  // the bundle's explicit `window` (the full selection), and pool-injected evidence keeps its own
  // timestamp instead of collapsing to the window end.
  it('prefers the bundle window and explicit evidence timestamps when present', () => {
    const withWindow = {
      ...bundle,
      window: { fromDate: '2025-11-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 90 },
    };
    const out = {
      ...goodOutput,
      // e9 must be cited — assembleProfile prunes evidence to referenced units.
      thinking: [...goodOutput.thinking, { claim: 'Keeps verified moments across runs', evidenceIds: ['e9'], confidence: 'low' }],
      evidence: [
        ...goodOutput.evidence,
        { id: 'e9', quote: 'a pooled quote from a past run', summary: 's', type: 'decision', conversationId: 'real-uuid-old', timestamp: '2026-02-02T00:00:00Z' },
      ],
    };
    const p = profileFromGptOutput(JSON.stringify(out), withWindow, opts);
    expect(p.sourceWindow).toEqual({ fromDate: '2025-11-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 90 });
    const e9 = p.evidence!.find((e) => e.id === 'e9')!;
    expect(e9.timestamp).toBe('2026-02-02T00:00:00Z');
    expect(e9.sourceRef.conversationId).toBe('real-uuid-old');
  });

  it('normalizes case-variant evidence type and confidence from the GPT', () => {
    const out = {
      thinking: [{ claim: 'c', evidenceIds: ['e1'], confidence: 'HIGH' }],
      evidence: [{ id: 'e1', quote: 'q', summary: 's', type: 'Decision', conversationId: 'c1' }],
    };
    const p = profileFromGptOutput(JSON.stringify(out), bundle, opts);
    expect(p.evidence!.find((e) => e.id === 'e1')!.type).toBe('decision'); // not silently 'episode'
  });

  it('dedupes repeated evidence ids (first wins), keeping the stored quote map deterministic', () => {
    const out = {
      thinking: [{ claim: 'c', evidenceIds: ['e1'], confidence: 'low' }],
      evidence: [
        { id: 'e1', quote: 'first', summary: 's', type: 'decision', conversationId: 'c1' },
        { id: 'e1', quote: 'second-dup', summary: 's', type: 'decision', conversationId: 'c2' },
      ],
    };
    const p = profileFromGptOutput(JSON.stringify(out), bundle, opts);
    const e1 = p.evidence!.filter((e) => e.id === 'e1');
    expect(e1).toHaveLength(1);
    expect(e1[0].quote).toBe('first');
  });

  it('does not resolve a malicious __proto__ conversationId to a prototype member', () => {
    const out = {
      thinking: [{ claim: 'c', evidenceIds: ['e1'], confidence: 'low' }],
      evidence: [{ id: 'e1', quote: 'q', summary: 's', type: 'decision', conversationId: '__proto__' }],
    };
    const p = profileFromGptOutput(JSON.stringify(out), bundle, opts);
    expect(p.evidence!.find((e) => e.id === 'e1')!.sourceRef.conversationId).toBe('__proto__'); // kept verbatim, not a function
  });

  // The live GPT (configured by the founder) returns a richer "assessments" shape with snake_case
  // evidence_ids, free-form evidence types, no conversationId, and no Jungian type. Accept it.
  it('maps the live "assessments" shape (assessments.* claim arrays + trajectory_shifts)', () => {
    const assessmentsOut = {
      version: 1,
      evidence: [
        { id: 'e1', quote: 'Que le pido en la analitica a un dm tipo 2', summary: 'asks labs for T2DM', type: 'clinical_workflow_question' },
        { id: 'e2', quote: 'Es esta una buena oportunidad para alquiler residencial?', summary: 'evaluates a rental', type: 'real_estate_investment_analysis' },
        { id: 'e3', quote: 'infografia , ya', summary: 'wants an infographic fast', type: 'direct_instruction' },
      ],
      assessments: {
        dominant_request_patterns: [
          { claim: 'Uses the assistant as a decision-support tool', evidence_ids: ['e1', 'e2'], confidence: 'high' },
        ],
        thinking_style: [
          { claim: 'Analytical and constraint-aware', evidence_ids: ['e2'], confidence: 'high' },
        ],
        communication_style: [
          { claim: 'Concise and direct', evidence_ids: ['e3'], confidence: 'high' },
        ],
        trajectory_shifts: [
          { claim: 'Shifts from medical toward investment topics over time', evidence_ids: ['e1', 'e2'], confidence: 'medium' },
        ],
        low_confidence_or_omitted: [{ area: 'personality type', reason: 'not enough signal' }],
      },
    };
    const p = profileFromGptOutput(JSON.stringify(assessmentsOut), bundle, opts);
    const claims = p.thinking.map((c) => c.claim);
    expect(claims).toContain('Uses the assistant as a decision-support tool');
    expect(claims).toContain('Analytical and constraint-aware');
    expect(claims).toContain('Concise and direct');
    expect(p.type).toBeUndefined(); // GPT omitted it; no type card
    expect(p.trajectory.shifts).toHaveLength(1);
    expect(p.trajectory.shifts[0].dimension).toContain('investment');
    // free-form evidence types collapse to the catch-all 'episode'
    expect(p.evidence!.find((e) => e.id === 'e1')!.type).toBe('episode');
    // no conversationId in evidence -> all under one 'unknown' convo -> confidence capped at medium
    expect(p.thinking.every((c) => c.confidence !== 'high')).toBe(true);
  });

  // INVARIANT #1: a ChatGPT-sourced profile, pushed to the backend, must carry no verbatim chat.
  it('never sends evidence quotes to the backend when pushing an imported profile', async () => {
    const withSecret = {
      ...goodOutput,
      evidence: [
        { id: 'e1', quote: 'SECRET-CHATGPT-VERBATIM-LINE', summary: 'plans', type: 'reasoning_move', conversationId: 'c1' },
        { id: 'e2', quote: 'another private line', summary: 'verifies', type: 'decision', conversationId: 'c2' },
        { id: 'e3', quote: 'third', summary: 'splits', type: 'decision', conversationId: 'c1' },
      ],
    };
    const profile = profileFromGptOutput(JSON.stringify(withSecret), bundle, opts);
    expect(profile.evidence!.some((e) => e.quote.includes('SECRET'))).toBe(true); // present locally

    const reqs: Array<{ url: string; init?: RequestInit }> = [];
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk',
      fetchFn: async (url, init) => { reqs.push({ url, init }); return new Response(JSON.stringify({ version: 1 }), { status: 200 }); },
    });
    await sync.pushProfile(profile);
    const body = reqs[0].init!.body as string;
    expect(body).not.toContain('SECRET-CHATGPT-VERBATIM-LINE');
    expect(body).not.toContain('another private line');
    expect(JSON.parse(body).evidence).toBeUndefined(); // whole evidence array stripped
    expect(JSON.parse(body).thinking.length).toBeGreaterThan(0); // badge still sent
  });
});
