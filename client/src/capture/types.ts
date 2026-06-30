export interface RawMessage { role: 'user' | 'assistant'; text: string; createdAt: string; }
export interface RawConversation { id: string; title: string; createdAt: string; messages: RawMessage[]; }

export interface CaptureAdapter {
  provider: 'claude' | 'chatgpt';
  listConversations(): Promise<{ id: string; updatedAt: string; model?: string }[]>;
  fetchConversation(id: string): Promise<RawConversation>;
}
