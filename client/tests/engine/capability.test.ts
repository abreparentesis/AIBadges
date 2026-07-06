import { describe, it, expect } from 'vitest';
import { computeCapability } from '../../src/engine/capability';
import { capabilityResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [
  { id: 'e1', timestamp: '2026-01-10T09:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c1' }, type: 'decision', quote: 'List the seams first.', summary: 'decompose' },
  { id: 'e2', timestamp: '2026-05-20T14:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c2' }, type: 'reasoning_move', quote: 'Verify before fixing.', summary: 'verify' },
];

describe('computeCapability', () => {
  it('returns a parsed Capability on a valid reply', async () => {
    const c = await computeCapability(evidence, { complete: async () => capabilityResponse });
    expect(c).not.toBeNull();
    expect(c!.aiFluency.delegation.band).toBe('proficient');
    expect(c!.aiFluency.diligence.band).toBe('advanced');
    expect(c!.yeggeStage.stage).toBe(4);
    expect(c!.domains).toHaveLength(1);
    expect(c!.domains[0].name).toBe('software engineering');
  });

  it('makes a draft call then an adversarial audit call on success', async () => {
    let calls = 0;
    await computeCapability(evidence, { complete: async () => { calls += 1; return capabilityResponse; } });
    expect(calls).toBe(2); // draft + audit
  });

  it('retries once on a fully unparseable draft, then succeeds (plus the audit call)', async () => {
    let calls = 0;
    const c = await computeCapability(evidence, {
      complete: async () => { calls += 1; return calls === 1 ? '{"aiFluency":{"del' : capabilityResponse; },
    });
    expect(calls).toBe(3); // bad draft, retried draft, audit
    expect(c).not.toBeNull();
    expect(c!.yeggeStage.stage).toBe(4);
  });

  it('uses the audit result over the draft (the audit tightens bands)', async () => {
    const downgraded = JSON.stringify({
      aiFluency: {
        delegation: { band: 'emerging', evidenceIds: [] }, description: { band: 'emerging', evidenceIds: [] },
        discernment: { band: 'emerging', evidenceIds: [] }, diligence: { band: 'emerging', evidenceIds: [] },
      },
      yeggeStage: { stage: 1, evidenceIds: [] }, domains: [],
    });
    let calls = 0;
    const c = await computeCapability(evidence, {
      complete: async () => { calls += 1; return calls === 1 ? capabilityResponse : downgraded; },
    });
    expect(calls).toBe(2);
    expect(c!.aiFluency.delegation.band).toBe('emerging'); // audit downgraded the draft's proficient
  });

  it('falls back to the draft when the audit reply is unparseable', async () => {
    let calls = 0;
    const c = await computeCapability(evidence, {
      complete: async () => { calls += 1; return calls === 1 ? capabilityResponse : 'garbage, not json'; },
    });
    expect(calls).toBe(2);
    expect(c).not.toBeNull();
    expect(c!.aiFluency.delegation.band).toBe('proficient'); // kept the draft when the audit failed
  });

  it('returns null (never throws) after 2 unparseable attempts', async () => {
    let calls = 0;
    const c = await computeCapability(evidence, { complete: async () => { calls += 1; return 'not json at all'; } });
    expect(calls).toBe(2);
    expect(c).toBeNull();
  });

  it('returns null (never throws) on a hard call error', async () => {
    const caller: ModelCaller = { complete: async () => { throw new Error('completion failed: 500'); } };
    await expect(computeCapability(evidence, caller)).resolves.toBeNull();
  });

  it('returns null on a response that parses as JSON but fails schema validation', async () => {
    const garbage = JSON.stringify({ aiFluency: { delegation: { band: 'not-a-band', evidenceIds: [] } } });
    const c = await computeCapability(evidence, { complete: async () => garbage });
    expect(c).toBeNull();
  });
});
