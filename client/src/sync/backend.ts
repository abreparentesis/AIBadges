import type { Profile } from '../engine/types';
import type { KV } from '../store/types';
import type { Provider } from '../store/provider';
import { ProfileStore } from '../store/local';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface SignalDisclosure {
  type: string;
  surfacedContent: Record<string, unknown>;
  disclosure: 'private' | 'public';
}
export interface SignalResult {
  type: string;
  disclosure: string;
  shareToken: string | null;
}

export interface BackendConfig {
  backendUrl: string;
  inviteToken: string;
  userKey: string;
  fetchFn?: FetchFn;
}

// Privacy boundary: the backend stores results/badges, NEVER raw chats. The profile's `evidence`
// array carries verbatim chat quotes (kept on-device for in-app auditability); it must not cross
// to the backend. Strip it before any push, so only the badge — claims, scores, type, trajectory,
// and the opaque evidenceIds (which resolve only locally) — is sent. Robust whether or not the
// profile carries an `evidence` field.
export function chatPrivateProfile<T extends object>(profile: T): T {
  const clone: Record<string, unknown> = { ...(profile as Record<string, unknown>) };
  delete clone.evidence;
  return clone as T;
}

// Set after a server-side deletion; the next share re-pushes the profile first, so server
// signals never exist without a backing profile version (a delete-then-reshare would
// otherwise resurrect the badge as orphaned signals). Per provider, like every other slot.
export const needsRepushKey = (provider: Provider) => `aibadges:needsProfileRepush:${provider}`;

export async function repushIfNeeded(kv: KV, sync: BackendSync, provider: Provider): Promise<boolean> {
  if ((await kv.get(needsRepushKey(provider))) !== '1') return false;
  const profile = await new ProfileStore(kv, provider).loadLatestProfile();
  if (profile) await sync.pushProfile(profile); // pushProfile strips evidence
  await kv.set(needsRepushKey(provider), '0');
  return profile != null;
}

export class BackendSync {
  private fetchFn: FetchFn;
  constructor(private cfg: BackendConfig) {
    this.fetchFn = cfg.fetchFn ?? ((url, init) => fetch(url, init));
  }

  async pushProfile(profile: Profile): Promise<{ version: number }> {
    const res = await this.fetchFn(`${this.cfg.backendUrl}/v1/profile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${this.cfg.userKey}`,
        // The backend only enforces this for a new key, so sending it always handles first-run registration.
        'X-AIBadges-Invite': this.cfg.inviteToken,
      },
      body: JSON.stringify(chatPrivateProfile(profile)),
    });
    if (!res.ok) throw new Error(`pushProfile failed: ${res.status}`);
    return (await res.json()) as { version: number };
  }

  // Self-serve erasure: removes everything the backend holds for this key (profile versions,
  // signals, share links, the user row). Local data is untouched; that stays the user's.
  async deleteServerData(): Promise<void> {
    const res = await this.fetchFn(`${this.cfg.backendUrl}/v1/profile`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.cfg.userKey}` },
    });
    if (!res.ok) throw new Error(`deleteServerData failed: ${res.status}`);
  }

  async setSignals(signals: SignalDisclosure[]): Promise<SignalResult[]> {
    const res = await this.fetchFn(`${this.cfg.backendUrl}/v1/signals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${this.cfg.userKey}`,
        // Lets a first-run user register by sharing, before any profile push.
        'X-AIBadges-Invite': this.cfg.inviteToken,
      },
      body: JSON.stringify(signals),
    });
    if (!res.ok) throw new Error(`setSignals failed: ${res.status}`);
    return ((await res.json()) as { signals: SignalResult[] }).signals;
  }
}
