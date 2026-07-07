import type { KV } from './types';
import type { Provider } from './provider';

// An opaque key per provider, generated once and persisted locally. Sent as the
// bearer token. No PII; separate keys give each provider its own backend
// profile, badge, and share URL (option B of the multi-provider design).
export async function ensureUserKey(kv: KV, provider: Provider): Promise<string> {
  const slot = `aibadges:userKey:${provider}`;
  const existing = await kv.get(slot);
  if (existing) return existing;
  const key = globalThis.crypto.randomUUID().replace(/-/g, '') + globalThis.crypto.randomUUID().replace(/-/g, '');
  await kv.set(slot, key);
  return key;
}
