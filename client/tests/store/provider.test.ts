import { describe, it, expect } from 'vitest';
import type { KV } from '../../src/store/types';
import { ProfileStore } from '../../src/store/local';
import { ensureUserKey } from '../../src/store/userkey';
import { inferProvider, migrateLegacySlots } from '../../src/store/provider';
import type { Profile } from '../../src/engine/types';

function memKv(init: Record<string, string> = {}): KV {
  const m = new Map(Object.entries(init));
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
  };
}

const profileFor = (provider: 'claude' | 'chatgpt', version = 1): Profile => ({
  version, computedAt: '2026-07-01T00:00:00Z',
  modelProvenance: provider === 'chatgpt' ? 'gpt-5.5' : 'claude-in-session',
  sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 20 },
  thinking: [], trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [] },
  evidence: [{
    id: 'e1', timestamp: '2026-01-02T00:00:00Z', type: 'decision',
    quote: 'a substantive quote of ample length for the gate', summary: 's',
    sourceRef: { provider, conversationId: 'c1' },
  }],
});

describe('per-provider profile slots', () => {
  it('claude and chatgpt runs never overwrite each other', async () => {
    const kv = memKv();
    await new ProfileStore(kv, 'claude').saveProfileVersion(profileFor('claude'));
    await new ProfileStore(kv, 'chatgpt').saveProfileVersion(profileFor('chatgpt'));
    const claude = await new ProfileStore(kv, 'claude').loadLatestProfile();
    const chatgpt = await new ProfileStore(kv, 'chatgpt').loadLatestProfile();
    expect(claude?.modelProvenance).toBe('claude-in-session');
    expect(chatgpt?.modelProvenance).toBe('gpt-5.5');
  });

  it('user keys are independent per provider (separate share URLs)', async () => {
    const kv = memKv();
    const a = await ensureUserKey(kv, 'claude');
    const b = await ensureUserKey(kv, 'chatgpt');
    expect(a).not.toBe(b);
    expect(await ensureUserKey(kv, 'claude')).toBe(a); // stable on re-ask
  });
});

describe('legacy migration', () => {
  it('moves the single-slot profile, signals, published value, and user key under its provider', async () => {
    const legacy = profileFor('chatgpt', 3);
    const kv = memKv({
      'aibadges:latestVersion': '3',
      'aibadges:profile:3': JSON.stringify(legacy),
      'aibadges:signals': '[{"type":"statBadge"}]',
      'aibadges:publishedStage': '62',
      'aibadges:userKey': 'legacy-key',
    });
    await migrateLegacySlots(kv);
    expect(await new ProfileStore(kv, 'chatgpt').latestVersion()).toBe(3);
    expect((await new ProfileStore(kv, 'chatgpt').loadLatestProfile())?.version).toBe(3);
    expect(await kv.get('aibadges:signals:chatgpt')).toContain('statBadge');
    expect(await kv.get('aibadges:publishedStage:chatgpt')).toBe('62');
    // the legacy key follows the profile so the existing share URL keeps working
    expect(await ensureUserKey(kv, 'chatgpt')).toBe('legacy-key');
    expect(await new ProfileStore(kv, 'claude').latestVersion()).toBe(0);
    // idempotent: second run does not clobber
    await migrateLegacySlots(kv);
    expect(await new ProfileStore(kv, 'chatgpt').latestVersion()).toBe(3);
  });

  it('does nothing when there is no legacy data', async () => {
    const kv = memKv();
    await migrateLegacySlots(kv);
    expect(await new ProfileStore(kv, 'claude').latestVersion()).toBe(0);
    expect(await new ProfileStore(kv, 'chatgpt').latestVersion()).toBe(0);
  });

  it('infers the provider from evidence, falling back to provenance', () => {
    expect(inferProvider(profileFor('claude'))).toBe('claude');
    expect(inferProvider({ ...profileFor('chatgpt'), evidence: [] })).toBe('chatgpt'); // via 'gpt' provenance
  });
});
