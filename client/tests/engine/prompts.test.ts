import { describe, it, expect } from 'vitest';
import { evidencePrompt, thinkingPrompt, capabilityPrompt, trajectoryPrompt, synthesisPrompt } from '../../src/prompts';
import { transcripts } from '../fixtures/transcripts';
import type { EvidenceUnit } from '../../src/engine/types';

const evidence: EvidenceUnit[] = [{
  id: 'c1:0', timestamp: '2026-01-10T09:00:00Z',
  sourceRef: { provider: 'claude', conversationId: 'c1' },
  type: 'decision', quote: 'List the seams first.', summary: 'Asks for decomposition seams.',
}];

describe('prompt builders', () => {
  it('evidence prompt includes conversation text and asks for JSON', () => {
    const p = evidencePrompt(transcripts);
    expect(p).toContain('List the seams first.');
    expect(p.toLowerCase()).toContain('json');
  });
  it('lens prompts include evidence ids', () => {
    expect(thinkingPrompt(evidence)).toContain('c1:0');
    expect(capabilityPrompt(evidence)).toContain('c1:0');
    expect(trajectoryPrompt(evidence)).toContain('c1:0');
  });
});

const ev: EvidenceUnit[] = [{ id: 'e1', timestamp: '2026-01-01T00:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c1' }, type: 'decision', quote: 'q', summary: 's' }];

describe('synthesisPrompt after the pivot', () => {
  it('asks for thinking, trajectory, and type but NOT capability', () => {
    const p = synthesisPrompt(ev);
    expect(p).toContain('"thinking"');
    expect(p).toContain('"trajectory"');
    expect(p).toContain('"type"');
    expect(p).not.toContain('aiFluency');
    expect(p).not.toContain('yeggeStage');
  });
});
