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

  it('makes exactly one completion call on success', async () => {
    let calls = 0;
    await computeCapability(evidence, { complete: async () => { calls += 1; return capabilityResponse; } });
    expect(calls).toBe(1);
  });

  it('retries once on a fully unparseable response, then succeeds', async () => {
    let calls = 0;
    const c = await computeCapability(evidence, {
      complete: async () => { calls += 1; return calls === 1 ? '{"aiFluency":{"del' : capabilityResponse; },
    });
    expect(calls).toBe(2);
    expect(c).not.toBeNull();
    expect(c!.yeggeStage.stage).toBe(4);
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
