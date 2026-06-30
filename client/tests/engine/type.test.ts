import { describe, it, expect } from 'vitest';
import { typeLens } from '../../src/engine/lenses/type';
import type { ModelCaller } from '../../src/inference/types';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [{
  id: 'e1', timestamp: '2026-01-10T09:00:00Z',
  sourceRef: { provider: 'claude', conversationId: 'c1' },
  type: 'reasoning_move', quote: 'Verify before fixing.', summary: 'hypothesis-driven',
}];

const good = JSON.stringify({
  code: 'INTJ', summary: 'Strategic, verification-driven.', confidence: 'medium',
  axes: {
    EI: { letter: 'I', lean: 70, evidenceIds: ['e1'] }, SN: { letter: 'N', lean: 60, evidenceIds: [] },
    TF: { letter: 'T', lean: 85, evidenceIds: ['e1'] }, JP: { letter: 'J', lean: 65, evidenceIds: [] },
  },
});

describe('typeLens', () => {
  it('returns a validated 4-letter cognitive type', async () => {
    const caller: ModelCaller = { complete: async () => good };
    const r = await typeLens(evidence, caller);
    expect(r?.code).toBe('INTJ');
    expect(r?.axes.TF.letter).toBe('T');
  });
  it('returns null on malformed model output', async () => {
    const caller: ModelCaller = { complete: async () => 'not a type at all' };
    expect(await typeLens(evidence, caller)).toBeNull();
  });
  it('returns null when there is no evidence (no quiz fallback)', async () => {
    const caller: ModelCaller = { complete: async () => good };
    expect(await typeLens([], caller)).toBeNull();
  });
  it('rejects an invalid 4-letter code', async () => {
    const bad = JSON.stringify({ code: 'XXXX', summary: 's', confidence: 'low',
      axes: { EI: { letter: 'I', lean: 50, evidenceIds: [] }, SN: { letter: 'N', lean: 50, evidenceIds: [] }, TF: { letter: 'T', lean: 50, evidenceIds: [] }, JP: { letter: 'J', lean: 50, evidenceIds: [] } } });
    const caller: ModelCaller = { complete: async () => bad };
    expect(await typeLens(evidence, caller)).toBeNull();
  });
});
