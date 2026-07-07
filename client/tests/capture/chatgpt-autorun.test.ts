import { describe, it, expect } from 'vitest';
import { parseEvidence, combineForImport, replyWaitDecision, planRun, assemblePool } from '../../src/capture/chatgpt-autorun';
import { buildSynthesisFromEvidence } from '../../src/capture/chatgpt-prompt';

describe('parseEvidence (map step)', () => {
  it('reads units from a fenced {"evidence":[...]} reply', () => {
    const reply = 'here you go\n```json\n{"evidence":[{"id":"e1","conversationId":"c3","quote":"do X end to end","summary":"s","type":"decision"}]}\n```';
    const out = parseEvidence(reply);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ conversationId: 'c3', quote: 'do X end to end', summary: 's', type: 'decision' });
  });

  it('also accepts a bare array and tolerates trailing commas', () => {
    const out = parseEvidence('[{"conversationId":"c1","quote":"q","type":"preference",},]');
    expect(out).toHaveLength(1);
    expect(out[0].quote).toBe('q');
    expect(out[0].summary).toBe(''); // defaulted
  });

  it('drops units with no quote and returns [] on garbage', () => {
    expect(parseEvidence('{"evidence":[{"conversationId":"c1"}]}')).toHaveLength(0);
    expect(parseEvidence('not json at all')).toEqual([]);
  });

  it('drops units with no conversationId (un-attributed quotes cannot be dated or de-duped)', () => {
    const out = parseEvidence('{"evidence":[{"quote":"orphan"},{"conversationId":"c2","quote":"kept"}]}');
    expect(out).toHaveLength(1);
    expect(out[0].conversationId).toBe('c2');
  });
});

describe('combineForImport (reduce step)', () => {
  const pooled = [
    { id: 'e1', conversationId: 'c1', quote: 'q1', summary: 's1', type: 'decision' },
    { id: 'e2', conversationId: 'c2', quote: 'q2', summary: 's2', type: 'episode' },
  ];
  const synth = JSON.stringify({
    thinking: [{ claim: 'x', evidenceIds: ['e1'], confidence: 'low' }],
    capability: { aiFluency: { delegation: { band: 'advanced', evidenceIds: ['e1', 'e2'] } }, yeggeStage: { stage: 6, evidenceIds: [] }, domains: [] },
  });
  const audit = JSON.stringify({
    aiFluency: {
      delegation: { band: 'developing', evidenceIds: ['e1'] }, description: { band: 'proficient', evidenceIds: ['e2'] },
      discernment: { band: 'emerging', evidenceIds: [] }, diligence: { band: 'emerging', evidenceIds: [] },
    },
    domains: [{ name: 'x', band: 'developing', evidenceIds: ['e1'] }],
  });

  it('attaches the client-pooled evidence and prefers the audited capability', () => {
    const root = JSON.parse(combineForImport(pooled, synth, audit));
    expect(root.evidence).toEqual(pooled); // client owns the evidence array
    expect(root.thinking[0].claim).toBe('x'); // profile carried from synthesis
    expect(root.capability.aiFluency.delegation.band).toBe('developing'); // audit replaced 'advanced'
    expect(root.capability.domains[0].band).toBe('developing');
    expect(root.capability.yeggeStage.stage).toBe(6); // kept from the synthesis draft
  });

  it('keeps the synthesis capability when the audit reply is unparseable', () => {
    const root = JSON.parse(combineForImport(pooled, synth, 'garbage'));
    expect(root.capability.aiFluency.delegation.band).toBe('advanced'); // fell back to the draft
    expect(root.evidence).toEqual(pooled);
  });

  it('rejects a partial audit (missing dimensions) and keeps the draft, not a band collapse', () => {
    const partial = JSON.stringify({ aiFluency: { delegation: { band: 'developing', evidenceIds: ['e1'] } } }); // only 1 of 4
    const root = JSON.parse(combineForImport(pooled, synth, partial));
    expect(root.capability.aiFluency.delegation.band).toBe('advanced'); // draft kept; not collapsed to emerging
  });
});

describe('buildSynthesisFromEvidence embeds the pooled ids', () => {
  it('renders each id, conversationId and quote so citations resolve', () => {
    const p = buildSynthesisFromEvidence([{ id: 'e7', conversationId: 'c4', quote: 'verify before acting', summary: 'v' }]);
    expect(p).toContain('e7 (c4): "verify before acting"');
    expect(p).toContain('Step 2 of 3');
  });
});

describe('replyWaitDecision (throttle-proof reply wait)', () => {
  const O = { timeoutMs: 240_000, minPolls: 8 };
  const S = { finished: false, hasText: true, stablePolls: 5, polls: 20, elapsedMs: 60_000 };
  it('accepts immediately on a server-confirmed finished reply', () => {
    expect(replyWaitDecision({ ...S, finished: true }, O)).toBe('accept');
  });
  it('waits while streaming, even long past the deadline if polls are few (throttled tab)', () => {
    expect(replyWaitDecision({ ...S, elapsedMs: 500_000, polls: 3 }, O)).toBe('wait');
  });
  it('accepts a partial only when its text has been stable across several polls', () => {
    expect(replyWaitDecision({ ...S, elapsedMs: 500_000, stablePolls: 4 }, O)).toBe('accept-partial');
    expect(replyWaitDecision({ ...S, elapsedMs: 500_000, stablePolls: 1 }, O)).toBe('timeout'); // mid-stream: never import
  });
  it('times out with no text after deadline and enough real polls', () => {
    expect(replyWaitDecision({ ...S, hasText: false, elapsedMs: 500_000 }, O)).toBe('timeout');
  });
});

describe('planRun (per-batch checkpoint resume)', () => {
  const now = Date.parse('2026-07-07T12:00:00Z');
  const u = (q: string) => ({ conversationId: 'c1', quote: q, summary: '', type: 'episode' });
  const ckpt = {
    v: 2, startedAt: '2026-07-07T11:00:00Z', totalBatches: 3,
    doneBatches: [0, 2], skippedBatches: [],
    unitsByBatch: { 0: [u('q-batch0')], 2: [u('q-batch2')] },
    convoId: 'old-convo',
  };
  it('resumes out-of-order completion: batches 0 and 2 done, batch 1 still pending', () => {
    const p = planRun(ckpt, 3, now);
    expect(p.resume).toBe(true);
    expect(p.doneBatches).toEqual([0, 2]);
    expect(p.skippedBatches).toEqual([]);
    expect(p.unitsByBatch[0][0].quote).toBe('q-batch0');
    expect(p.unitsByBatch[2][0].quote).toBe('q-batch2');
    expect(p.staleConvoId).toBe('old-convo');
    // The only batch left to run is 1 — the same remaining-computation the orchestrator does.
    const remaining = [0, 1, 2].filter((b) => !p.doneBatches.includes(b) && !p.skippedBatches.includes(b));
    expect(remaining).toEqual([1]);
  });
  it('keeps the skip list and never re-runs a skipped batch', () => {
    const p = planRun({ ...ckpt, doneBatches: [2], skippedBatches: [0] }, 3, now);
    expect(p.resume).toBe(true);
    expect(p.skippedBatches).toEqual([0]);
    const remaining = [0, 1, 2].filter((b) => !p.doneBatches.includes(b) && !p.skippedBatches.includes(b));
    expect(remaining).toEqual([1]);
  });
  it('drops out-of-range and duplicate batch indices instead of trusting them', () => {
    const p = planRun({ ...ckpt, doneBatches: [0, 0, 2, 7, -1], skippedBatches: [2, 1] }, 3, now);
    expect(p.doneBatches).toEqual([0, 2]);
    expect(p.skippedBatches).toEqual([1]); // 2 is done, so it can't also be skipped
  });
  it('a checkpoint past synthesis resumes with the synth text', () => {
    const p = planRun({ ...ckpt, doneBatches: [0, 1, 2], synthText: '{"thinking":[]}' }, 3, now);
    expect(p.resume).toBe(true);
    expect(p.synthText).toBe('{"thinking":[]}');
  });
  it('discards a stale checkpoint but still surfaces the orphan conversation for cleanup', () => {
    const p = planRun({ ...ckpt, startedAt: '2026-07-05T11:00:00Z' }, 3, now);
    expect(p.resume).toBe(false);
    expect(p.doneBatches).toEqual([]);
    expect(p.unitsByBatch).toEqual({});
    expect(p.staleConvoId).toBe('old-convo');
  });
  it('discards a checkpoint whose batch shape no longer matches the capture', () => {
    expect(planRun(ckpt, 5, now).resume).toBe(false);
  });
  it('discards a legacy v1 (count-based) checkpoint but surfaces its conversation for cleanup', () => {
    const v1 = {
      v: 1, startedAt: '2026-07-07T11:00:00Z', totalBatches: 3, batchesDone: 2, skippedBatches: [1],
      pooled: [{ id: 'e1', conversationId: 'c1', quote: 'q', summary: '', type: 'episode' }],
      convoId: 'legacy-convo',
    };
    const p = planRun(v1, 3, now);
    expect(p.resume).toBe(false);
    expect(p.doneBatches).toEqual([]);
    expect(p.staleConvoId).toBe('legacy-convo');
  });
  it('handles null/garbage checkpoints', () => {
    expect(planRun(null, 3, now)).toEqual({ resume: false, doneBatches: [], skippedBatches: [], unitsByBatch: {} });
    expect(planRun({ v: 9 }, 3, now).resume).toBe(false);
  });
});

describe('assemblePool (id-stable pooling across parallel batches)', () => {
  const u = (cid: string, q: string) => ({ conversationId: cid, quote: q, summary: '', type: 'episode' });
  it('numbers ids by BATCH order, not completion order, so out-of-order runs and resumes agree', () => {
    // Batch 2 finished before batch 0 (doneBatches records completion order).
    const pooled = assemblePool({ 2: [u('c9', 'late')], 0: [u('c1', 'a'), u('c2', 'b')] }, [2, 0]);
    expect(pooled.map((p) => p.id)).toEqual(['e1', 'e2', 'e3']);
    expect(pooled[0].quote).toBe('a');   // batch 0 first, whatever finished first
    expect(pooled[2].quote).toBe('late');
  });
  it('ignores units of batches not marked done and tolerates missing entries', () => {
    const pooled = assemblePool({ 0: [u('c1', 'a')], 1: [u('c2', 'zombie')] }, [0, 2]);
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toEqual({ ...u('c1', 'a'), id: 'e1' });
  });
  it('returns [] when nothing completed (the all-batches-failed terminal case)', () => {
    expect(assemblePool({}, [])).toEqual([]);
  });
});
