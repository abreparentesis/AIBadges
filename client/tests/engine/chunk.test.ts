import { describe, it, expect } from 'vitest';
import { chunkConversations, convoChars } from '../../src/engine/chunk';
import { transcripts } from '../fixtures/transcripts';

describe('chunkConversations', () => {
  it('keeps each chunk under the char budget', () => {
    const chunks = chunkConversations(transcripts, 120);
    for (const chunk of chunks) {
      expect(chunk.reduce((n, c) => n + convoChars(c), 0)).toBeLessThanOrEqual(120 + Math.max(...transcripts.map(convoChars)));
    }
  });
  it('packs both small convos into one chunk under a large budget', () => {
    expect(chunkConversations(transcripts, 100000)).toHaveLength(1);
  });
  it('splits into one chunk per convo under a tiny budget', () => {
    expect(chunkConversations(transcripts, 1)).toHaveLength(2);
  });
});
