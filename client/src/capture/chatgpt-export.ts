import type { RawConversation } from './types';

// The payload the user hands to the AIBadges Custom GPT. Conversations get short synthetic ids
// (c1, c2, ...) instead of the real ChatGPT UUIDs: the GPT is asked to cite a conversationId in
// its evidence, and short ids are easier for it to echo correctly and keep the real ids off the
// third party. The real id stays on-device in `idMap` so imported evidence can resolve back to it.
export interface GptExportMessage { role: 'user' | 'assistant'; text: string; }
export interface GptExportConversation {
  conversationId: string;
  title: string;
  createdAt: string;
  messages: GptExportMessage[];
}
export interface ChatGptExport {
  version: 1;
  instructionsFor: 'aibadges-gpt';
  conversations: GptExportConversation[];
}
export interface CaptureBundle {
  export: ChatGptExport;
  idMap: Record<string, string>; // synthetic id (c1) -> real ChatGPT conversation id
  capturedAt: string;
}

export interface ExportOpts { perConvoChars?: number; }

const DEFAULT_PER_CONVO = 6000;

// Truncate each conversation to a per-conversation character budget (sequentially, oldest message
// first) so a few very long chats can't dominate the paste, and skip anything that comes out empty.
export function buildChatGptExport(convos: RawConversation[], now: string, opts: ExportOpts = {}): CaptureBundle {
  const perConvo = opts.perConvoChars ?? DEFAULT_PER_CONVO;
  const idMap: Record<string, string> = {};
  const conversations: GptExportConversation[] = [];

  for (const c of convos) {
    let budget = perConvo;
    const messages: GptExportMessage[] = [];
    for (const m of c.messages) {
      if (budget <= 0) break;
      const text = m.text.length > budget ? m.text.slice(0, budget) : m.text;
      if (!text) continue;
      budget -= text.length;
      messages.push({ role: m.role, text });
    }
    if (messages.length === 0) continue;
    // Contiguous ids over the KEPT conversations (skipped/empty ones leave no gap), so the GPT
    // sees c1, c2, ... with no holes and idMap stays in lockstep.
    const cid = `c${conversations.length + 1}`;
    idMap[cid] = c.id;
    conversations.push({ conversationId: cid, title: c.title ?? '', createdAt: c.createdAt, messages });
  }

  return { export: { version: 1, instructionsFor: 'aibadges-gpt', conversations }, idMap, capturedAt: now };
}

// Total character count of the export payload — used to warn the user when the paste is large.
export function exportSize(bundle: CaptureBundle): number {
  return bundle.export.conversations.reduce(
    (n, c) => n + c.messages.reduce((s, m) => s + m.text.length, 0), 0,
  );
}
