import { describe, it, expect } from 'vitest';
import { BackendSync, chatPrivateProfile, repushIfNeeded, NEEDS_REPUSH_KEY } from '../../src/sync/backend';
import type { Profile } from '../../src/engine/types';

const profile = { version: 1 } as unknown as Profile;

function fakeFetch(captured: { reqs: Array<{ url: string; init?: RequestInit }> }, responder: (url: string) => Response) {
  return async (url: string, init?: RequestInit) => { captured.reqs.push({ url, init }); return responder(url); };
}

describe('BackendSync.pushProfile', () => {
  it('sends bearer + invite headers and returns the version', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response(JSON.stringify({ version: 3 }), { status: 200 })),
    });
    const out = await sync.pushProfile(profile);
    expect(out).toEqual({ version: 3 });
    const h = captured.reqs[0].init!.headers as Record<string, string>;
    expect(captured.reqs[0].url).toBe('https://api.test/v1/profile');
    expect(h['Authorization']).toBe('Bearer uk1');
    expect(h['X-AIBadges-Invite']).toBe('INV');
  });

  it('strips raw chat evidence (quotes) from the pushed body — the backend never sees chats', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response(JSON.stringify({ version: 1 }), { status: 200 })),
    });
    const withEvidence = {
      version: 1, computedAt: '2026-06-08T00:00:00Z', modelProvenance: 'm',
      sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 2 },
      thinking: [{ claim: 'Plans before editing', evidenceIds: ['e1'], confidence: 'high' }],
      trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [] },
      evidence: [{ id: 'e1', quote: 'SECRET-VERBATIM-CHAT-LINE', summary: 'plans first', type: 'decision', timestamp: '2026-01-01T00:00:00Z', sourceRef: { provider: 'claude', conversationId: 'c1' } }],
    } as unknown as Profile;

    await sync.pushProfile(withEvidence);
    const body = JSON.parse(captured.reqs[0].init!.body as string);
    expect(body.evidence).toBeUndefined();                                  // evidence array dropped
    expect(JSON.stringify(body)).not.toContain('SECRET-VERBATIM-CHAT-LINE'); // no quote text anywhere
    expect(body.thinking[0].claim).toBe('Plans before editing');            // badge content kept
    expect(body.thinking[0].evidenceIds).toEqual(['e1']);                   // opaque ids fine (resolve only on-device)
  });

  it('chatPrivateProfile leaves a profile without evidence unchanged', () => {
    const p = { version: 2, thinking: [] } as unknown as Profile;
    expect(chatPrivateProfile(p)).toEqual({ version: 2, thinking: [] });
  });

  it('throws on a non-ok response', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response('nope', { status: 401 })),
    });
    await expect(sync.pushProfile(profile)).rejects.toThrow('pushProfile failed: 401');
  });
});

describe('BackendSync.deleteServerData', () => {
  it('sends DELETE /v1/profile with the bearer key and resolves on ok', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response(JSON.stringify({ deleted: true }), { status: 200 })),
    });
    await sync.deleteServerData();
    expect(captured.reqs[0].url).toBe('https://api.test/v1/profile');
    expect(captured.reqs[0].init!.method).toBe('DELETE');
    expect((captured.reqs[0].init!.headers as Record<string, string>)['Authorization']).toBe('Bearer uk1');
    expect(captured.reqs[0].init!.body).toBeUndefined(); // nothing to send, nothing to leak
  });

  it('throws on a non-ok response', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response('nope', { status: 500 })),
    });
    await expect(sync.deleteServerData()).rejects.toThrow('deleteServerData failed: 500');
  });
});

describe('repushIfNeeded (post-deletion profile re-push)', () => {
  function memKv(init: Record<string, string> = {}) {
    const m = new Map(Object.entries(init));
    return {
      get: async (k: string) => m.get(k) ?? null,
      set: async (k: string, v: string) => { m.set(k, v); },
      dump: () => Object.fromEntries(m),
    };
  }
  const storedProfile = JSON.stringify({
    version: 2, thinking: [{ claim: 'Plans first', evidenceIds: ['e1'], confidence: 'high' }],
    evidence: [{ id: 'e1', quote: 'SECRET-VERBATIM-CHAT-LINE' }],
  });

  it('re-pushes the latest local profile (evidence stripped) and clears the flag', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response(JSON.stringify({ version: 1 }), { status: 200 })),
    });
    const kv = memKv({ [NEEDS_REPUSH_KEY]: '1', 'aibadges:latestVersion': '2', 'aibadges:profile:2': storedProfile });
    expect(await repushIfNeeded(kv, sync)).toBe(true);
    expect(captured.reqs[0].url).toBe('https://api.test/v1/profile');
    expect(JSON.stringify(JSON.parse(captured.reqs[0].init!.body as string))).not.toContain('SECRET-VERBATIM-CHAT-LINE');
    expect(await kv.get(NEEDS_REPUSH_KEY)).toBe('0');
  });

  it('does nothing when the flag is not set', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response('{}', { status: 200 })),
    });
    const kv = memKv({ 'aibadges:latestVersion': '2', 'aibadges:profile:2': storedProfile });
    expect(await repushIfNeeded(kv, sync)).toBe(false);
    expect(captured.reqs.length).toBe(0);
  });

  it('clears the flag even when no local profile exists to push', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response('{}', { status: 200 })),
    });
    const kv = memKv({ [NEEDS_REPUSH_KEY]: '1' });
    expect(await repushIfNeeded(kv, sync)).toBe(false);
    expect(captured.reqs.length).toBe(0);
    expect(await kv.get(NEEDS_REPUSH_KEY)).toBe('0');
  });
});

describe('BackendSync.setSignals', () => {
  it('returns the signals with share tokens', async () => {
    const captured = { reqs: [] as Array<{ url: string; init?: RequestInit }> };
    const sync = new BackendSync({
      backendUrl: 'https://api.test', inviteToken: 'INV', userKey: 'uk1',
      fetchFn: fakeFetch(captured, () => new Response(JSON.stringify({ signals: [{ type: 'identityCard', disclosure: 'published', shareToken: 'tok123' }] }), { status: 200 })),
    });
    const res = await sync.setSignals([{ type: 'identityCard', surfacedContent: {}, disclosure: 'published' }]);
    expect(res[0].shareToken).toBe('tok123');
    expect(captured.reqs[0].url).toBe('https://api.test/v1/signals');
    expect((captured.reqs[0].init!.headers as Record<string, string>)['X-AIBadges-Invite']).toBe('INV');
  });
});
