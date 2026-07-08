import { describe, it, expect } from 'vitest';
import { shouldReveal, dismissKey } from '../../src/ui/reveal';

describe('shouldReveal (in-page self-reveal decision)', () => {
  it('reveals only for users with no profile who have not dismissed it', () => {
    expect(shouldReveal(0, undefined)).toBe(true);
  });
  it('never reveals once a profile exists — it is an acquisition nudge, not a reminder', () => {
    expect(shouldReveal(1, undefined)).toBe(false);
    expect(shouldReveal(25, undefined)).toBe(false);
  });
  it('one dismissal hides it permanently', () => {
    expect(shouldReveal(0, 1751900000000)).toBe(false);
  });
  it('dismissal is provider-scoped', () => {
    expect(dismissKey('claude')).not.toBe(dismissKey('chatgpt'));
  });
});
