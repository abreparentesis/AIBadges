import { describe, it, expect } from 'vitest';
import { ensureUserKey } from '../../src/store/userkey';
import type { KV } from '../../src/store/types';

function memKv(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } };
}

describe('ensureUserKey', () => {
  it('generates a key once and returns the same key thereafter', async () => {
    const kv = memKv();
    const k1 = await ensureUserKey(kv);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    const k2 = await ensureUserKey(kv);
    expect(k2).toBe(k1);
  });
});
