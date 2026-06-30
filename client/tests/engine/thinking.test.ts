import { describe, it, expect } from 'vitest';
import { thinkingLens } from '../../src/engine/lenses/thinking';
import { thinkingResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [{
  id: 'c1:0', timestamp: '2026-01-10T09:00:00Z',
  sourceRef: { provider: 'claude', conversationId: 'c1' },
  type: 'decision', quote: 'List the seams first.', summary: 'seams first',
}];
const caller: ModelCaller = { complete: async () => thinkingResponse };

describe('thinkingLens', () => {
  it('returns validated claims', async () => {
    const claims = await thinkingLens(evidence, caller);
    expect(claims).toHaveLength(2);
    expect(claims[0].claim).toContain('Decomposes');
    expect(claims[0].confidence).toBe('high');
  });

  it('degrades to [] when the model output is not valid claims JSON', async () => {
    const bad: ModelCaller = { complete: async () => 'I cannot help with that.' };
    expect(await thinkingLens(evidence, bad)).toEqual([]);
  });

  it('retries once and succeeds when the first completion is truncated', async () => {
    let calls = 0;
    const flaky: ModelCaller = {
      complete: async () => {
        calls += 1;
        return calls === 1 ? '[{"claim":"Decomposes prob' /* truncated */ : thinkingResponse;
      },
    };
    const claims = await thinkingLens(evidence, flaky);
    expect(calls).toBe(2);
    expect(claims).toHaveLength(2);
  });
});
