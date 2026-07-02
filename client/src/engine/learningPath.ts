import type { Capability } from './types';

export interface LearningLink {
  label: string;
  url: string;
}

export type Dimension = 'delegation' | 'description' | 'discernment' | 'diligence';

export interface LearningStep {
  dimension: Dimension;
  band: string;
  how: string;
  links: LearningLink[];
}

const BAND_WEIGHT: Record<string, number> = {
  emerging: 0,
  developing: 1,
  proficient: 2,
  advanced: 3,
};

const DIMENSION_ORDER: Dimension[] = ['delegation', 'description', 'discernment', 'diligence'];

const CURATED: Record<Dimension, { how: string; links: LearningLink[] }> = {
  delegation: {
    how: 'Give the model whole tasks with clear success criteria and let it use tools, instead of micromanaging each step.',
    links: [
      {
        label: 'Anthropic — Building effective agents',
        url: 'https://www.anthropic.com/engineering/building-effective-agents',
      },
    ],
  },
  description: {
    how: 'Sharpen your prompts: state the goal, give context and examples, and specify the output format you want.',
    links: [
      {
        label: 'Anthropic — Prompt engineering overview',
        url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview',
      },
    ],
  },
  discernment: {
    how: 'Pressure-test answers: ask for sources, cross-check claims, and watch for confident-but-wrong output.',
    links: [
      {
        label: 'Anthropic — Reduce hallucinations',
        url: 'https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations',
      },
    ],
  },
  diligence: {
    how: 'Verify before you ship: review outputs, run the code/tests, and iterate rather than accepting the first draft.',
    links: [
      {
        label: 'Anthropic — Define your success criteria',
        url: 'https://docs.anthropic.com/en/docs/test-and-evaluate/define-success',
      },
    ],
  },
};

export function learningPath(capability: Capability): LearningStep[] {
  const { aiFluency } = capability;

  const ranked = DIMENSION_ORDER
    .map((dimension, index) => ({
      dimension,
      band: aiFluency[dimension].band,
      weight: BAND_WEIGHT[aiFluency[dimension].band],
      index,
    }))
    .filter((entry) => entry.band !== 'advanced')
    .sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.index - b.index;
    })
    .slice(0, 3);

  return ranked.map((entry) => {
    const curated = CURATED[entry.dimension];
    return {
      dimension: entry.dimension,
      band: entry.band,
      how: curated.how,
      links: curated.links,
    };
  });
}
