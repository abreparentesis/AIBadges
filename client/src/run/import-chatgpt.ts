import { profileFromGptOutput } from '../engine/chatgpt-import';
import { distill } from '../engine/distill';
import { ProfileStore } from '../store/local';
import { chromeKv } from '../store/chrome-kv';
import { ensureUserKey } from '../store/userkey';
import { BackendSync, NEEDS_REPUSH_KEY } from '../sync/backend';
import { BACKEND_URL, INVITE_TOKEN } from '../config';
import type { CaptureBundle } from '../capture/chatgpt-export';
import type { Profile } from '../engine/types';
import type { KV } from '../store/types';

export const CAPTURE_KEY = 'aibadges:chatgpt:capture';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function loadCaptureBundle(kv: KV = chromeKv): Promise<CaptureBundle | null> {
  const raw = await kv.get(CAPTURE_KEY);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as CaptureBundle;
    return b && b.export && Array.isArray(b.export.conversations) ? b : null;
  } catch { return null; }
}

export interface ImportDeps {
  kv?: KV;
  now?: string;
  fetchFn?: FetchFn;        // for the backend sync (injectable in tests)
  backendUrl?: string;
  inviteToken?: string;
}

// Parse a GPT reply against the stored capture, persist it locally (with evidence, for the audit
// view), sync ONLY the badge (pushProfile strips the evidence array), then drop the raw-chat
// capture. Shared by the manual paste flow and the in-ChatGPT bridge so both behave identically.
export async function importGptReply(replyText: string, deps: ImportDeps = {}): Promise<Profile> {
  const kv = deps.kv ?? chromeKv;
  const now = deps.now ?? new Date().toISOString();
  const bundle = await loadCaptureBundle(kv);
  if (!bundle) throw new Error('No captured ChatGPT history found. Capture it first, then try again.');

  const store = new ProfileStore(kv);
  const version = (await store.latestVersion()) + 1;
  const profile = profileFromGptOutput(replyText, bundle, { version, now });

  await store.saveProfileVersion(profile);
  await kv.set('aibadges:signals', JSON.stringify(distill(profile, now)));
  try {
    const userKey = await ensureUserKey(kv);
    await new BackendSync({
      backendUrl: deps.backendUrl ?? BACKEND_URL,
      inviteToken: deps.inviteToken ?? INVITE_TOKEN,
      userKey,
      fetchFn: deps.fetchFn,
    }).pushProfile(profile);
    await kv.set(NEEDS_REPUSH_KEY, '0'); // fresh push satisfies the post-delete repush guarantee
  } catch (e) { console.warn('[aibadges] sync failed (non-fatal):', (e as Error)?.message ?? 'unknown'); }

  await kv.set('aibadges:status', 'done');
  await kv.set(CAPTURE_KEY, ''); // drop the raw-chat payload; loadCaptureBundle treats '' as absent
  return profile;
}
