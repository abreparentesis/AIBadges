import { describe, it, expect } from 'vitest';
import { trajectoryLens } from '../../src/engine/lenses/trajectory';
import { trajectoryResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [
  { id: 'c1:0', timestamp: '2026-01-10T09:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c1' },
    type: 'decision', quote: 'a', summary: 'a' },
  { id: 'c2:0', timestamp: '2026-05-20T14:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c2' },
    type: 'reasoning_move', quote: 'b', summary: 'b' },
];
const caller: ModelCaller = { complete: async () => trajectoryResponse };

describe('trajectoryLens', () => {
  it('returns shifts and a time window spanning the evidence', async () => {
    const t = await trajectoryLens(evidence, caller);
    expect(t.shifts[0].direction).toBe('rising');
    expect(t.window.earlyTo <= t.window.recentFrom).toBe(true);
  });
  it('returns an empty trajectory when there is no evidence', async () => {
    const t = await trajectoryLens([], caller);
    expect(t.shifts).toEqual([]);
  });
  it('degrades to no shifts when the model output is malformed', async () => {
    const bad: ModelCaller = { complete: async () => 'oops not json' };
    const t = await trajectoryLens(evidence, bad);
    expect(t.shifts).toEqual([]);
  });
});
