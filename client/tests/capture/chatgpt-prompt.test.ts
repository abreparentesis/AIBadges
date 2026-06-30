import { describe, it, expect } from 'vitest';
import { buildBridgePrompt, BRIDGE_INSTRUCTIONS } from '../../src/capture/chatgpt-prompt';
import type { CaptureBundle } from '../../src/capture/chatgpt-export';

const bundle: CaptureBundle = {
  capturedAt: '2026-06-08T00:00:00Z',
  idMap: { c1: 'uuid-A' },
  export: {
    version: 1, instructionsFor: 'aibadges-gpt',
    conversations: [{ conversationId: 'c1', title: 't', createdAt: '2026-01-01T00:00:00Z', messages: [{ role: 'user', text: 'hello world' }] }],
  },
};

describe('buildBridgePrompt', () => {
  it('combines the hardened instructions with the export payload', () => {
    const p = buildBridgePrompt(bundle);
    expect(p.startsWith(BRIDGE_INSTRUCTIONS)).toBe(true);
    expect(p).toContain('INPUT:');
    expect(p).toContain('"conversationId":"c1"');
    expect(p).toContain('hello world');
  });

  it('instructs a single valid fenced JSON block and conversationId citing', () => {
    expect(BRIDGE_INSTRUCTIONS).toContain('```json');
    expect(BRIDGE_INSTRUCTIONS.toLowerCase()).toContain('conversationid');
    expect(BRIDGE_INSTRUCTIONS).toContain('Output JSON only');
  });

  it('does not leak real conversation UUIDs into the prompt (synthetic ids only)', () => {
    expect(buildBridgePrompt(bundle)).not.toContain('uuid-A');
  });
});
