import { describe, it, expect } from 'vitest';
import { namedLevel } from '../../src/engine/levels';

describe('namedLevel', () => {
  it('maps stage 1 to Explorer', () => {
    expect(namedLevel(1)).toEqual({ name: 'Explorer', stage: 1 });
  });
  it('maps stage 2 to Explorer', () => {
    expect(namedLevel(2)).toEqual({ name: 'Explorer', stage: 2 });
  });
  it('maps stage 3 to Operator', () => {
    expect(namedLevel(3)).toEqual({ name: 'Operator', stage: 3 });
  });
  it('maps stage 4 to Operator', () => {
    expect(namedLevel(4)).toEqual({ name: 'Operator', stage: 4 });
  });
  it('maps stage 5 to Practitioner', () => {
    expect(namedLevel(5)).toEqual({ name: 'Practitioner', stage: 5 });
  });
  it('maps stage 6 to Practitioner', () => {
    expect(namedLevel(6)).toEqual({ name: 'Practitioner', stage: 6 });
  });
  it('maps stage 7 to Orchestrator', () => {
    expect(namedLevel(7)).toEqual({ name: 'Orchestrator', stage: 7 });
  });
  it('maps stage 8 to Orchestrator', () => {
    expect(namedLevel(8)).toEqual({ name: 'Orchestrator', stage: 8 });
  });
  it('clamps stage 0 up to 1 (Explorer)', () => {
    expect(namedLevel(0)).toEqual({ name: 'Explorer', stage: 1 });
  });
  it('clamps stage 9 down to 8 (Orchestrator)', () => {
    expect(namedLevel(9)).toEqual({ name: 'Orchestrator', stage: 8 });
  });
});
