import type { KV } from './types';

export const chromeKv: KV = {
  async get(key) {
    const r = await chrome.storage.local.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};
