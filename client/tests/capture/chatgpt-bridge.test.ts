import { describe, it, expect } from 'vitest';
import { chooseChatGptModelLabel, watcherDecision, type WatchState } from '../../src/capture/chatgpt-bridge';

const base: WatchState = {
  hasNewTurn: true, generating: false, everGenerated: true, hasText: true, textStableMs: 3000, elapsedMs: 5000,
};
const opts = { stableMs: 2500, timeoutMs: 720000 };

describe('watcherDecision', () => {
  it('finalizes once generation is done and the reply has been stable long enough', () => {
    expect(watcherDecision(base, opts)).toBe('finalize');
  });

  it('waits before the user has sent (no new assistant turn)', () => {
    expect(watcherDecision({ ...base, hasNewTurn: false }, opts)).toBe('wait');
  });

  it('never finalizes before generation was ever observed (guards the pre-send empty read)', () => {
    expect(watcherDecision({ ...base, everGenerated: false }, opts)).toBe('wait');
  });

  it('waits while the model is still generating, even if text looks momentarily stable', () => {
    expect(watcherDecision({ ...base, generating: true }, opts)).toBe('wait');
  });

  it('waits on a streaming pause that is shorter than the stability window (no partial finalize)', () => {
    expect(watcherDecision({ ...base, textStableMs: 1200 }, opts)).toBe('wait');
  });

  it('waits when there is no text yet', () => {
    expect(watcherDecision({ ...base, hasText: false, textStableMs: 0 }, opts)).toBe('wait');
  });

  it('on timeout, imports if a real reply arrived', () => {
    expect(watcherDecision({ ...base, elapsedMs: 800000, generating: true }, opts)).toBe('finalize');
  });

  it('on timeout with no reply, gives up instead of importing empty', () => {
    expect(watcherDecision({ ...base, elapsedMs: 800000, hasNewTurn: false, hasText: false }, opts)).toBe('giveup');
  });
});

describe('chooseChatGptModelLabel', () => {
  it('uses a cheap capable model for extraction instead of Pro Extended', () => {
    expect(chooseChatGptModelLabel(['Pro Extended', 'Thinking', 'Instant'], 'extract')).toBe('Instant');
  });

  it('falls back to mini/fast style models for extraction when instant is absent', () => {
    expect(chooseChatGptModelLabel(['GPT-5 Thinking', 'GPT-4o mini', 'Pro'], 'extract')).toBe('GPT-4o mini');
  });

  it('uses the strongest normal chat model for synthesis and audit', () => {
    expect(chooseChatGptModelLabel(['Instant', 'Thinking', 'Pro Extended'], 'best')).toBe('Pro Extended');
  });

  it('ignores unavailable and non-chat tools in the model menu', () => {
    expect(chooseChatGptModelLabel(['Deep research', 'Pro (limit reached)', 'Fast'], 'best')).toBe('Fast');
  });
});
