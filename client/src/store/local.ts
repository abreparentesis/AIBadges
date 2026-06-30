import type { KV } from './types';
import { EvidenceUnit, Profile } from '../engine/types';

const EVIDENCE_KEY = 'aibadges:evidence';
const LATEST_KEY = 'aibadges:latestVersion';
const profileKey = (v: number) => `aibadges:profile:${v}`;

export class ProfileStore {
  constructor(private kv: KV) {}

  async saveEvidence(units: EvidenceUnit[]): Promise<void> {
    await this.kv.set(EVIDENCE_KEY, JSON.stringify(units));
  }
  async loadEvidence(): Promise<EvidenceUnit[]> {
    const raw = await this.kv.get(EVIDENCE_KEY);
    return raw ? (JSON.parse(raw) as EvidenceUnit[]) : [];
  }
  async saveProfileVersion(p: Profile): Promise<void> {
    await this.kv.set(profileKey(p.version), JSON.stringify(p));
    if (p.version > (await this.latestVersion())) {
      await this.kv.set(LATEST_KEY, String(p.version));
    }
  }
  async latestVersion(): Promise<number> {
    return Number((await this.kv.get(LATEST_KEY)) ?? '0');
  }
  async loadProfile(version: number): Promise<Profile | null> {
    const raw = await this.kv.get(profileKey(version));
    return raw ? (JSON.parse(raw) as Profile) : null;
  }
}
