import { describe, it, expect } from 'vitest';
import { pickModels } from '../../src/engine/models';

describe('pickModels', () => {
  it('splits fast (sonnet) vs best (opus) by capability', () => {
    expect(pickModels(['claude-opus-4-8', 'claude-sonnet-4-6'])).toEqual({ fast: 'claude-sonnet-4-6', best: 'claude-opus-4-8' });
  });
  it('prefers haiku as the fast model when available', () => {
    expect(pickModels(['claude-opus-4-8', 'claude-haiku-4-5', 'claude-sonnet-4-6']).fast).toBe('claude-haiku-4-5');
  });
  it('uses the one model for both when only one is available', () => {
    expect(pickModels(['claude-sonnet-4-6'])).toEqual({ fast: 'claude-sonnet-4-6', best: 'claude-sonnet-4-6' });
  });
  it('returns nulls when nothing is available', () => {
    expect(pickModels([null, undefined])).toEqual({ fast: null, best: null });
  });
});
