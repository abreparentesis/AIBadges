import { describe, it, expect } from 'vitest';
import { extractEvidence } from '../../src/engine/evidence';
import { transcripts } from '../fixtures/transcripts';
import { evidenceResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';

const caller: ModelCaller = { complete: async () => evidenceResponse };

describe('extractEvidence', () => {
  it('maps conversation labels to short evidence ids', async () => {
    const units = await extractEvidence(transcripts, caller, { maxChars: 100000 });
    expect(units).toHaveLength(2);
    expect(units[0].id).toBe('e1');
    expect(units[0].sourceRef.conversationId).toBe('c1');
    expect(units[1].id).toBe('e2');
    expect(units[1].sourceRef.conversationId).toBe('c2');
  });

  it('calls the model twice per chunk (general pass + reaction-focused sweep)', async () => {
    let calls = 0;
    const counting: ModelCaller = { complete: async () => { calls++; return evidenceResponse; } };
    await extractEvidence(transcripts, counting, { maxChars: 1 });
    expect(calls).toBe(4); // 2 chunks x 2 passes
  });

  it('dedupes units the two passes both found (same conversation, same quote)', async () => {
    // Both passes return the identical fixture, so without dedupe every unit would appear twice.
    const units = await extractEvidence(transcripts, caller, { maxChars: 100000 });
    expect(units).toHaveLength(2);
  });

  it('skips non-array model output', async () => {
    const weird: ModelCaller = { complete: async () => JSON.stringify({ not: 'an array' }) };
    expect(await extractEvidence(transcripts, weird, { maxChars: 100000 })).toEqual([]);
  });

  it('ignores evidence attributed to a conversation label that is not in the chunk', async () => {
    const hallucinated: ModelCaller = { complete: async () => JSON.stringify([
      { conversationLabel: 99, timestamp: '2026-01-01T00:00:00Z', type: 'decision', quote: 'q', summary: 's' },
    ]) };
    expect(await extractEvidence(transcripts, hallucinated, { maxChars: 100000 })).toEqual([]);
  });

  it('parses bracketed string labels like "[1]" (how the model actually echoes them)', async () => {
    const bracketed: ModelCaller = { complete: async () => JSON.stringify([
      { conversationLabel: '[1]', timestamp: '2026-01-10T09:00:00Z', type: 'decision', quote: 'q', summary: 's' },
      { conversationLabel: '[2]', timestamp: '2026-05-20T14:00:00Z', type: 'episode', quote: 'q2', summary: 's2' },
    ]) };
    const units = await extractEvidence(transcripts, bracketed, { maxChars: 100000 });
    expect(units).toHaveLength(2);
    expect(units[0].id).toBe('e1');
    expect(units[0].sourceRef.conversationId).toBe('c1');
    expect(units[1].sourceRef.conversationId).toBe('c2');
  });
});
