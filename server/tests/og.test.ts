import { describe, it, expect } from 'bun:test';
import { renderBadgeSvg } from '../src/og';

const content = {
  yeggeStage: 5,
  aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'proficient' },
};

describe('renderBadgeSvg', () => {
  it('renders the stage headline and brand at 1200x627', () => {
    const svg = renderBadgeSvg(content);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="627"');
    expect(svg).toContain('AI Fluency Index - Stage 5');
    expect(svg).toContain('AIBADGES');
  });

  it('renders one labelled bar per fluency dimension', () => {
    const svg = renderBadgeSvg(content);
    for (const label of ['Delegation', 'Description', 'Discernment', 'Diligence']) {
      expect(svg).toContain(label);
    }
    expect(svg).toContain('advanced');
  });

  it('degrades to the stage-only layout when bands are missing', () => {
    const svg = renderBadgeSvg({ yeggeStage: 3 });
    expect(svg).toContain('AI Fluency Index - Stage 3');
    expect(svg).not.toContain('Delegation');
  });

  it('escapes markup in stage input', () => {
    const svg = renderBadgeSvg({ yeggeStage: '<script>' as unknown as number });
    expect(svg).not.toContain('<script>');
  });
});

import { svgToPng, PNG_MAGIC, loadFallbackPng } from '../src/og';

describe('svgToPng', () => {
  it('rasterizes the badge SVG to a real PNG', () => {
    const png = svgToPng(renderBadgeSvg(content));
    expect(png.length).toBeGreaterThan(1000);
    expect(Array.from(png.subarray(0, 4))).toEqual(Array.from(PNG_MAGIC));
  });
});

describe('loadFallbackPng', () => {
  it('returns the committed PNG asset', () => {
    const png = loadFallbackPng();
    expect(Array.from(png.subarray(0, 4))).toEqual(Array.from(PNG_MAGIC));
    expect(loadFallbackPng()).toBe(png); // cached
  });
});
