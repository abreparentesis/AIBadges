import type { Profile } from '../engine/types';

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
