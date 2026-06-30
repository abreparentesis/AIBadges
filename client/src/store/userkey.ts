import type { KV } from './types';

const USER_KEY = 'aibadges:userKey';

// An opaque per-user key, generated once and persisted locally. Sent as the bearer token.
// No PII; isolates each user on the backend.
export async function ensureUserKey(kv: KV): Promise<string> {
  const existing = await kv.get(USER_KEY);
  if (existing) return existing;
  const key = globalThis.crypto.randomUUID().replace(/-/g, '') + globalThis.crypto.randomUUID().replace(/-/g, '');
  await kv.set(USER_KEY, key);
  return key;
}
