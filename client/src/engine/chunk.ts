import type { RawConversation } from '../capture/types';

export function convoChars(c: RawConversation): number {
  return c.messages.reduce((n, m) => n + m.text.length, 0);
}

export function chunkConversations(convos: RawConversation[], maxChars: number): RawConversation[][] {
  const chunks: RawConversation[][] = [];
  let current: RawConversation[] = [];
  let size = 0;
  for (const c of convos) {
    const cChars = convoChars(c);
    if (current.length > 0 && size + cChars > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(c);
    size += cChars;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
