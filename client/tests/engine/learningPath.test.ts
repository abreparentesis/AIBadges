import { describe, it, expect } from 'vitest';
import { learningPath } from '../../src/engine/learningPath';
import type { Capability } from '../../src/engine/types';

type Band = 'emerging' | 'developing' | 'proficient' | 'advanced';

function makeCapability(bands: {
  delegation: Band;
  description: Band;
  discernment: Band;
  diligence: Band;
}): Capability {
  return {
    aiFluency: {
      delegation: { band: bands.delegation, evidenceIds: [] },
      description: { band: bands.description, evidenceIds: [] },
      discernment: { band: bands.discernment, evidenceIds: [] },
      diligence: { band: bands.diligence, evidenceIds: [] },
    },
    yeggeStage: { stage: 4, evidenceIds: [] },
    domains: [],
  };
}

describe('learningPath', () => {
  it('returns [] when all four dimensions are advanced', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'advanced',
      discernment: 'advanced',
      diligence: 'advanced',
    });
    expect(learningPath(capability)).toEqual([]);
  });

  it('returns at most 3 steps', () => {
    const capability = makeCapability({
      delegation: 'emerging',
      description: 'emerging',
      discernment: 'emerging',
      diligence: 'emerging',
    });
    const steps = learningPath(capability);
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps.length).toBe(3);
  });

  it('picks the weakest dimensions first', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'proficient',
      discernment: 'emerging',
      diligence: 'developing',
    });
    const steps = learningPath(capability);
    expect(steps.map((s) => s.dimension)).toEqual(['discernment', 'diligence', 'description']);
  });

  it('breaks ties using the fixed dimension order [delegation, description, discernment, diligence]', () => {
    const capability = makeCapability({
      delegation: 'developing',
      description: 'developing',
      discernment: 'emerging',
      diligence: 'emerging',
    });
    const steps = learningPath(capability);
    // emerging (weight 0) before developing (weight 1); ties broken by fixed order
    expect(steps.map((s) => s.dimension)).toEqual(['discernment', 'diligence', 'delegation']);
  });

  it('excludes advanced dimensions even when fewer than 3 remain', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'advanced',
      discernment: 'advanced',
      diligence: 'emerging',
    });
    const steps = learningPath(capability);
    expect(steps.map((s) => s.dimension)).toEqual(['diligence']);
  });

  it('carries the correct band and curated how-text/links for delegation', () => {
    const capability = makeCapability({
      delegation: 'emerging',
      description: 'advanced',
      discernment: 'advanced',
      diligence: 'advanced',
    });
    const [step] = learningPath(capability);
    expect(step.dimension).toBe('delegation');
    expect(step.band).toBe('emerging');
    expect(step.how).toBe(
      'Give the model whole tasks with clear success criteria and let it use tools, instead of micromanaging each step.'
    );
    expect(step.links).toEqual([
      { label: 'Anthropic — Building effective agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' },
    ]);
  });

  it('carries the correct curated how-text/links for description', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'developing',
      discernment: 'advanced',
      diligence: 'advanced',
    });
    const [step] = learningPath(capability);
    expect(step.dimension).toBe('description');
    expect(step.how).toBe(
      'Sharpen your prompts: state the goal, give context and examples, and specify the output format you want.'
    );
    expect(step.links).toEqual([
      { label: 'Anthropic — Prompt engineering overview', url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview' },
    ]);
  });

  it('carries the correct curated how-text/links for discernment', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'advanced',
      discernment: 'developing',
      diligence: 'advanced',
    });
    const [step] = learningPath(capability);
    expect(step.dimension).toBe('discernment');
    expect(step.how).toBe(
      'Pressure-test answers: ask for sources, cross-check claims, and watch for confident-but-wrong output.'
    );
    expect(step.links).toEqual([
      { label: 'Anthropic — Reduce hallucinations', url: 'https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations' },
    ]);
  });

  it('carries the correct curated how-text/links for diligence', () => {
    const capability = makeCapability({
      delegation: 'advanced',
      description: 'advanced',
      discernment: 'advanced',
      diligence: 'developing',
    });
    const [step] = learningPath(capability);
    expect(step.dimension).toBe('diligence');
    expect(step.how).toBe(
      'Verify before you ship: review outputs, run the code/tests, and iterate rather than accepting the first draft.'
    );
    expect(step.links).toEqual([
      { label: 'Anthropic — Define your success criteria', url: 'https://docs.anthropic.com/en/docs/test-and-evaluate/define-success' },
    ]);
  });
});
