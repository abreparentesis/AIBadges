import { describe, it, expect } from 'vitest';
import { buildProfile } from '../../src/engine/profile';
import { ProfileSchema } from '../../src/engine/types';
import { transcripts } from '../fixtures/transcripts';
import { evidenceResponse, synthesisResponse } from '../fixtures/model-responses';
import type { ModelCaller } from '../../src/inference/types';

// Evidence extraction and the one combined synthesis call are routed by a keyword in the prompt.
const caller: ModelCaller = {
  complete: async (prompt: string) => {
    if (prompt.includes('extracting behavioral evidence')) return evidenceResponse;
    return synthesisResponse;
  },
};

describe('buildProfile', () => {
  it('produces a schema-valid profile from transcripts', async () => {
    const p = await buildProfile(transcripts, caller, { fluencyOnly: false,
      version: 1, now: '2026-06-05T00:00:00Z', modelProvenance: 'claude-in-session',
    });
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(p.version).toBe(1);
    expect(p.sourceWindow.conversationCount).toBe(2);
    expect(p.sourceWindow.fromDate).toBe('2026-01-10T09:00:00Z');
    expect(p.thinking.length).toBeGreaterThan(0);
    expect(p.capability).toBeUndefined();
    expect(p.type?.code).toBe('INTJ');
    expect(p.trajectory.shifts.length).toBeGreaterThan(0);
    // Evidence used by surviving claims/axes/shifts is stored for auditability.
    expect(p.evidence).toBeDefined();
    expect(p.evidence!.length).toBeGreaterThan(0);
  });

  it('drops claims whose evidence ids all got pruned; keeps the backed one', async () => {
    const ghostCaller: ModelCaller = {
      complete: async (prompt: string) => {
        if (prompt.includes('extracting behavioral evidence')) return evidenceResponse; // yields e1, e2
        return JSON.stringify({
          thinking: [
            { claim: 'Real anchored claim', evidenceIds: ['e1'], confidence: 'high' },
            { claim: 'Loosely grounded claim', evidenceIds: ['ghost:9'], confidence: 'low' },
          ],
          trajectory: { shifts: [] },
        });
      },
    };
    const p = await buildProfile(transcripts, ghostCaller, { fluencyOnly: false,
      version: 1, now: '2026-06-05T00:00:00Z', modelProvenance: 'm',
    });
    // The 'ghost:9'-only claim is unbacked under the new rule and is dropped; only the real claim survives.
    expect(p.thinking).toHaveLength(1);
    expect(p.thinking[0].claim).toBe('Real anchored claim');
    expect(p.thinking[0].evidenceIds).toEqual(['e1']);
    expect(p.thinking.find((c) => c.claim === 'Loosely grounded claim')).toBeUndefined();
  });

  it('grades a claim backed by >=3 ids across >=2 conversations as high', async () => {
    // Richer evidence: 2 units from c1 + 1 from c2, all quoting real transcript text.
    const richEvidence = JSON.stringify([
      { conversationLabel: 1, type: 'decision', quote: 'Should I split this 2000-line file?',
        summary: 'Weighs splitting a large file.' },
      { conversationLabel: 1, type: 'reasoning_move', quote: 'List the seams first.',
        summary: 'Asks for decomposition seams first.' },
      { conversationLabel: 2, type: 'reasoning_move', quote: 'Verify before fixing.',
        summary: 'Insists on verification before fixing.' },
    ]);
    const richCaller: ModelCaller = {
      complete: async (prompt: string) => {
        if (prompt.includes('extracting behavioral evidence')) return richEvidence; // e1,e2 (c1); e3 (c2)
        return JSON.stringify({
          thinking: [
            // 3 ids across 2 conversations -> high
            { claim: 'Decomposes deliberately', evidenceIds: ['e1', 'e2', 'e3'], confidence: 'low' },
            // 2 ids, both in the same conversation -> medium (n>=2 but convos<2)
            { claim: 'Plans before editing', evidenceIds: ['e1', 'e2'], confidence: 'high' },
            // 1 id -> low
            { claim: 'Verifies hypotheses', evidenceIds: ['e3'], confidence: 'high' },
          ],
          trajectory: { shifts: [] },
          type: null,
        });
      },
    };
    const p = await buildProfile(transcripts, richCaller, { fluencyOnly: false,
      version: 2, now: '2026-06-05T00:00:00Z', modelProvenance: 'm',
    });
    expect(p.thinking).toHaveLength(3);
    expect(p.thinking.find((c) => c.claim === 'Decomposes deliberately')!.confidence).toBe('high');
    expect(p.thinking.find((c) => c.claim === 'Plans before editing')!.confidence).toBe('medium');
    expect(p.thinking.find((c) => c.claim === 'Verifies hypotheses')!.confidence).toBe('low');
    // Stored evidence resolves every referenced id and only those.
    const storedIds = p.evidence!.map((e) => e.id).sort();
    expect(storedIds).toEqual(['e1', 'e2', 'e3']);
  });
});
