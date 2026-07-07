import { describe, it, expect } from 'vitest';
import { importGptReply, loadCaptureBundle, CAPTURE_KEY } from '../../src/run/import-chatgpt';
import type { KV } from '../../src/store/types';
import type { CaptureBundle } from '../../src/capture/chatgpt-export';

function memKv(seed: Record<string, string> = {}): KV & { store: Record<string, string> } {
  const store: Record<string, string> = { ...seed };
  return { store, async get(k) { return store[k] ?? null; }, async set(k, v) { store[k] = v; } };
}

const bundle: CaptureBundle = {
  capturedAt: '2026-06-08T00:00:00Z',
  idMap: { c1: 'uuid-A', c2: 'uuid-B' },
  export: {
    version: 1, instructionsFor: 'aibadges-gpt',
    conversations: [
      { conversationId: 'c1', title: 't1', createdAt: '2026-01-01T00:00:00Z', messages: [{ role: 'user', text: 'hi' }] },
      { conversationId: 'c2', title: 't2', createdAt: '2026-05-01T00:00:00Z', messages: [{ role: 'user', text: 'yo' }] },
    ],
  },
};

// A realistic product reply: fluency capability (what the autorun produces) plus a legacy thinking
// claim, so the pipeline is exercised in the shape the shipping FLUENCY_ONLY mode actually saves.
const reply = JSON.stringify({
  thinking: [{ claim: 'Plans before acting', evidenceIds: ['e1', 'e2'], confidence: 'low' }],
  capability: {
    aiFluency: {
      delegation: { band: 'developing', note: 'You hand off scoped tasks.', evidenceIds: ['e1'] },
      description: { band: 'proficient', note: 'You give goals plus constraints.', evidenceIds: ['e2'] },
      discernment: { band: 'developing', note: 'You sometimes push back.', evidenceIds: ['e1'] },
      diligence: { band: 'emerging', note: 'You rarely verify.', evidenceIds: [] },
    },
    yeggeStage: { stage: 3, evidenceIds: ['e1'] },
    domains: [],
  },
  evidence: [
    { id: 'e1', conversationId: 'c1', quote: 'SECRET-CHATGPT-LINE-A', summary: 's', type: 'decision' },
    { id: 'e2', conversationId: 'c2', quote: 'SECRET-CHATGPT-LINE-B', summary: 's', type: 'decision' },
  ],
});

describe('loadCaptureBundle', () => {
  it('returns null for absent or empty/corrupt storage', async () => {
    expect(await loadCaptureBundle(memKv())).toBeNull();
    expect(await loadCaptureBundle(memKv({ [CAPTURE_KEY]: '' }))).toBeNull();
    expect(await loadCaptureBundle(memKv({ [CAPTURE_KEY]: 'not json' }))).toBeNull();
  });
  it('parses a stored bundle', async () => {
    const kv = memKv({ [CAPTURE_KEY]: JSON.stringify(bundle) });
    const b = await loadCaptureBundle(kv);
    expect(b?.export.conversations).toHaveLength(2);
  });
});

describe('importGptReply', () => {
  it('persists the profile + signals, marks done, and clears the raw capture', async () => {
    const kv = memKv({ [CAPTURE_KEY]: JSON.stringify(bundle) });
    const profile = await importGptReply(reply, { kv, now: '2026-06-08T00:00:00Z', fetchFn: async () => new Response(JSON.stringify({ version: 1 }), { status: 200 }) });

    expect(profile.thinking.length).toBeGreaterThan(0);
    expect(kv.store['aibadges:profile:chatgpt:1']).toBeTruthy();
    expect(kv.store['aibadges:latestVersion:chatgpt']).toBe('1');
    expect(kv.store['aibadges:signals:chatgpt']).toBeTruthy();
    expect(kv.store['aibadges:status']).toBe('done');
    expect(kv.store[CAPTURE_KEY]).toBe(''); // raw chat payload dropped
  });

  it('syncs only the badge — no verbatim chat quotes reach the backend', async () => {
    const kv = memKv({ [CAPTURE_KEY]: JSON.stringify(bundle) });
    const bodies: string[] = [];
    await importGptReply(reply, {
      kv, now: '2026-06-08T00:00:00Z', backendUrl: 'https://api.test', inviteToken: 'INV',
      fetchFn: async (_url, init) => { bodies.push(String(init?.body ?? '')); return new Response(JSON.stringify({ version: 1 }), { status: 200 }); },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain('SECRET-CHATGPT-LINE-A');
    expect(bodies[0]).not.toContain('SECRET-CHATGPT-LINE-B');
    expect(JSON.parse(bodies[0]).evidence).toBeUndefined();
    // but the on-device profile keeps the quotes for the audit view
    const stored = JSON.parse(kv.store['aibadges:profile:chatgpt:1']);
    expect(JSON.stringify(stored)).toContain('SECRET-CHATGPT-LINE-A');
  });

  it('still saves locally when the backend sync fails (sync is non-fatal)', async () => {
    const kv = memKv({ [CAPTURE_KEY]: JSON.stringify(bundle) });
    const profile = await importGptReply(reply, { kv, now: '2026-06-08T00:00:00Z', fetchFn: async () => new Response('nope', { status: 500 }) });
    expect(profile.version).toBe(1);
    expect(kv.store['aibadges:status']).toBe('done');
  });

  it('throws when there is no capture to import against', async () => {
    await expect(importGptReply(reply, { kv: memKv(), now: '2026-06-08T00:00:00Z' })).rejects.toThrow(/No captured/);
  });
});
