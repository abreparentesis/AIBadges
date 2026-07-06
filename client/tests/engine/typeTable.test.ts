import { describe, it, expect } from 'vitest';
import { lookupType } from '../../src/engine/typeTable';

describe('lookupType', () => {
  it('maps a code to its name, group, and color', () => {
    const m = lookupType('INTJ');
    expect(m.name).toBe('The Strategist');
    expect(m.group).toBe('Analysts');
    expect(m.color).toMatch(/^#/);
  });
  it('is case-insensitive', () => {
    expect(lookupType('enfp').group).toBe('Diplomats');
  });
  it('falls back gracefully for an unknown code', () => {
    expect(lookupType('ZZZZ').name).toBe('Undetermined');
  });
  it("uses AI Fluency Index' own names, not the 16Personalities set", () => {
    const blocked = ['Architect', 'Logician', 'Commander', 'Debater', 'Advocate', 'Mediator', 'Protagonist', 'Campaigner', 'Logistician', 'Defender', 'Executive', 'Consul', 'Virtuoso', 'Adventurer', 'Entrepreneur', 'Entertainer'];
    const codes = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];
    for (const c of codes) expect(blocked).not.toContain(lookupType(c).name);
  });
});
