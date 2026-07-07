import { profileFromGptOutput } from '../engine/chatgpt-import';
import { distill } from '../engine/distill';
import { carryOverSharing } from '../sync/signal-state';
import { ProfileStore } from '../store/local';
import { chromeKv } from '../store/chrome-kv';
import { ensureUserKey } from '../store/userkey';
import { BackendSync, needsRepushKey } from '../sync/backend';
import { runKey } from '../store/provider';
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

  const store = new ProfileStore(kv, 'chatgpt');
  const version = (await store.latestVersion()) + 1;
  const profile = profileFromGptOutput(replyText, bundle, { version, now });

  await store.saveProfileVersion(profile);
  // Publishing is USER state, not run output: a re-run must not flip a published badge back to
  // private (that bug made the share section "forget" the URL after every run).
  const signals = carryOverSharing(await kv.get('aibadges:signals:chatgpt'), distill(profile, now, undefined, 'ChatGPT'));
  await kv.set('aibadges:signals:chatgpt', JSON.stringify(signals));
  try {
    const userKey = await ensureUserKey(kv, 'chatgpt');
    const sync = new BackendSync({
      backendUrl: deps.backendUrl ?? BACKEND_URL,
      inviteToken: deps.inviteToken ?? INVITE_TOKEN,
      userKey,
      fetchFn: deps.fetchFn,
    });
    await sync.pushProfile(profile);
    await kv.set(needsRepushKey('chatgpt'), '0'); // fresh push satisfies the post-delete repush guarantee
    // Keep the public share page in sync with the newest run (the server keeps the token, so the
    // URL never changes — only its content).
    const pub = signals.filter((s) => s.disclosure === 'public');
    if (pub.length) {
      await sync.setSignals(pub.map((s) => ({ type: s.type, surfacedContent: s.surfacedContent, disclosure: 'public' as const })));
      const stat = pub.find((s) => s.type === 'statBadge');
      if (stat) {
        const c = stat.surfacedContent as { fluencyScore?: number; yeggeStage?: number | string };
        await kv.set('aibadges:publishedStage:chatgpt', String(c.fluencyScore ?? c.yeggeStage ?? ''));
      }
    }
  } catch (e) { console.warn('[aibadges] sync failed (non-fatal):', (e as Error)?.message ?? 'unknown'); }

  await kv.set(runKey('status', 'chatgpt'), 'done');
  await kv.set(CAPTURE_KEY, ''); // drop the raw-chat payload; loadCaptureBundle treats '' as absent
  return profile;
}
