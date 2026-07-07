import type { KV } from './types';
import { EvidenceUnit, Profile } from '../engine/types';
import type { Provider } from './provider';

// All slots are namespaced per provider so Claude and ChatGPT runs never
// overwrite each other (see provider.ts for the one-time legacy migration).
export class ProfileStore {
  constructor(private kv: KV, private provider: Provider) {}

  private key(name: string): string {
    return `aibadges:${name}:${this.provider}`;
  }

  async saveEvidence(units: EvidenceUnit[]): Promise<void> {
    await this.kv.set(this.key('evidence'), JSON.stringify(units));
  }
  async loadEvidence(): Promise<EvidenceUnit[]> {
    const raw = await this.kv.get(this.key('evidence'));
    return raw ? (JSON.parse(raw) as EvidenceUnit[]) : [];
  }
  async saveProfileVersion(p: Profile): Promise<void> {
    await this.kv.set(`aibadges:profile:${this.provider}:${p.version}`, JSON.stringify(p));
    if (p.version > (await this.latestVersion())) {
      await this.kv.set(this.key('latestVersion'), String(p.version));
    }
  }
  async latestVersion(): Promise<number> {
    return Number((await this.kv.get(this.key('latestVersion'))) ?? '0');
  }
  async loadProfile(version: number): Promise<Profile | null> {
    const raw = await this.kv.get(`aibadges:profile:${this.provider}:${version}`);
    return raw ? (JSON.parse(raw) as Profile) : null;
  }
  async loadLatestProfile(): Promise<Profile | null> {
    const v = await this.latestVersion();
    return v > 0 ? this.loadProfile(v) : null;
  }
}
