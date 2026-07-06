import { describe, it, expect } from 'vitest';
import { parseEvidence, combineForImport } from '../../src/capture/chatgpt-autorun';
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
    aiFluency: { delegation: { band: 'developing', evidenceIds: ['e1'] } },
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
});

describe('buildSynthesisFromEvidence embeds the pooled ids', () => {
  it('renders each id, conversationId and quote so citations resolve', () => {
    const p = buildSynthesisFromEvidence([{ id: 'e7', conversationId: 'c4', quote: 'verify before acting', summary: 'v' }]);
    expect(p).toContain('e7 (c4): "verify before acting"');
    expect(p).toContain('Step 2 of 3');
  });
});
