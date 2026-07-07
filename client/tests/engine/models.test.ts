import { describe, it, expect } from 'vitest';
import { pickModels } from '../../src/engine/models';

describe('pickModels', () => {
  it('extracts with sonnet, synthesizes with opus', () => {
    expect(pickModels(['claude-opus-4-8', 'claude-sonnet-4-6'])).toEqual({ extract: 'claude-sonnet-4-6', best: 'claude-opus-4-8' });
  });
  it('NEVER extracts with haiku when anything better exists (haiku under-mined reaction evidence)', () => {
    expect(pickModels(['claude-opus-4-8', 'claude-haiku-4-5', 'claude-sonnet-4-6']).extract).toBe('claude-sonnet-4-6');
  });
  it('falls back to the best model when the account has no sonnet', () => {
    expect(pickModels(['claude-opus-4-8', 'claude-haiku-4-5'])).toEqual({ extract: 'claude-opus-4-8', best: 'claude-opus-4-8' });
  });
  it('uses haiku only when it is genuinely all there is', () => {
    expect(pickModels(['claude-haiku-4-5'])).toEqual({ extract: 'claude-haiku-4-5', best: 'claude-haiku-4-5' });
  });
  it('uses the one model for both when only one is available', () => {
    expect(pickModels(['claude-sonnet-4-6'])).toEqual({ extract: 'claude-sonnet-4-6', best: 'claude-sonnet-4-6' });
  });
  it('returns nulls when nothing is available', () => {
    expect(pickModels([null, undefined])).toEqual({ extract: null, best: null });
  });
});
