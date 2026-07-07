import { describe, it, expect } from 'vitest';
import { namedLevel } from '../../src/engine/levels';

describe('namedLevel', () => {
  it('maps stages 1-2 to Beginner', () => {
    expect(namedLevel(1)).toEqual({ name: 'Beginner', stage: 1 });
    expect(namedLevel(2)).toEqual({ name: 'Beginner', stage: 2 });
  });
  it('maps stages 3-4 to Intermediate', () => {
    expect(namedLevel(3)).toEqual({ name: 'Intermediate', stage: 3 });
    expect(namedLevel(4)).toEqual({ name: 'Intermediate', stage: 4 });
  });
  it('maps stages 5-6 to Advanced', () => {
    expect(namedLevel(5)).toEqual({ name: 'Advanced', stage: 5 });
    expect(namedLevel(6)).toEqual({ name: 'Advanced', stage: 6 });
  });
  it('maps stages 7-8 to Expert (agentic sources only)', () => {
    expect(namedLevel(7)).toEqual({ name: 'Expert', stage: 7 });
    expect(namedLevel(8)).toEqual({ name: 'Expert', stage: 8 });
  });
  it('clamps out-of-range stages', () => {
    expect(namedLevel(0)).toEqual({ name: 'Beginner', stage: 1 });
    expect(namedLevel(9)).toEqual({ name: 'Expert', stage: 8 });
  });
});
