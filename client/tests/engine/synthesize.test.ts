import { describe, it, expect } from 'vitest';
import { synthesize } from '../../src/engine/synthesize';
import { synthesisResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [
  { id: 'e1', timestamp: '2026-01-10T09:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c1' }, type: 'decision', quote: 'List the seams first.', summary: 'decompose' },
  { id: 'e2', timestamp: '2026-05-20T14:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c2' }, type: 'reasoning_move', quote: 'Verify before fixing.', summary: 'verify' },
];

describe('synthesize', () => {
  it('parses thinking, trajectory, and type from one combined completion', async () => {
    const s = await synthesize(evidence, { complete: async () => synthesisResponse });
    expect(s.thinking.length).toBe(2);
    expect(s.trajectory.shifts.length).toBe(1);
    expect(s.trajectory.window.earlyTo).toBe('2026-01-10T09:00:00Z');
    expect(s.type?.code).toBe('INTJ');
    expect(s.type?.axes.TF.letter).toBe('T');
  });

  it('makes exactly one completion call', async () => {
    let calls = 0;
    await synthesize(evidence, { complete: async () => { calls += 1; return synthesisResponse; } });
    expect(calls).toBe(1);
  });

  it('returns type=null when the combined output omits it', async () => {
    const noType = JSON.stringify({ thinking: [{ claim: 'x', evidenceIds: ['e1'], confidence: 'low' }], trajectory: { shifts: [] } });
    const s = await synthesize(evidence, { complete: async () => noType });
    expect(s.type).toBeNull();
    expect(s.thinking.length).toBe(1);
  });

  it('degrades a bad part without wiping the others', async () => {
    const partial = JSON.stringify({ thinking: [{ claim: 'kept', evidenceIds: ['e1'], confidence: 'high' }], trajectory: 'garbage', type: null });
    const s = await synthesize(evidence, { complete: async () => partial });
    expect(s.thinking.length).toBe(1);
    expect(s.trajectory.shifts).toEqual([]);
  });

  it('propagates a hard call error (so the run is not saved empty)', async () => {
    let calls = 0;
    await expect(synthesize(evidence, { complete: async () => { calls += 1; throw new Error('completion failed: 500'); } })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('retries once on a fully unparseable response, then succeeds', async () => {
    let calls = 0;
    const s = await synthesize(evidence, { complete: async () => { calls += 1; return calls === 1 ? '{"thinking":[{"cla' : synthesisResponse; } });
    expect(calls).toBe(2);
    expect(s.thinking.length).toBe(2);
  });
});
