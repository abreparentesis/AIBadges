import type { KV } from './types';
import type { Profile } from '../engine/types';

/**
 * A profile's source. Claude and ChatGPT histories are measured separately —
 * each provider gets its own local slots, its own backend user key, and
 * therefore its own share URL; runs never overwrite each other.
 */
export type Provider = 'claude' | 'chatgpt';

export const PROVIDERS: Provider[] = ['claude', 'chatgpt'];

export const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
};

/**
 * Run-lifecycle storage keys, namespaced per provider so the two flows can
 * never bleed state into each other (a ChatGPT error showing in the Claude
 * panel, one provider's "done" masking the other's run).
 */
export type RunKeyName = 'status' | 'error' | 'progress' | 'startedAt';
export const runKey = (name: RunKeyName, provider: Provider): string => `aibadges:${name}:${provider}`;

/** Infer which provider produced a stored profile (legacy, pre-namespacing). */
export function inferProvider(p: Profile): Provider {
  const fromEvidence = p.evidence?.[0]?.sourceRef?.provider;
  if (fromEvidence === 'chatgpt' || fromEvidence === 'claude') return fromEvidence;
  return /gpt/i.test(p.modelProvenance) ? 'chatgpt' : 'claude';
}

/**
 * One-time migration from the single-slot era: move the legacy profile,
 * signals, published value, and user key under the provider that produced
 * them, so the existing share URL keeps working for that provider. Safe to
 * call on every load; does nothing once the legacy keys are gone.
 */
export async function migrateLegacySlots(kv: KV): Promise<void> {
  const legacyLatest = await kv.get('aibadges:latestVersion');
  if (!legacyLatest) return;
  const raw = await kv.get(`aibadges:profile:${legacyLatest}`);
  if (raw) {
    const profile = JSON.parse(raw) as Profile;
    const p = inferProvider(profile);
    if (!(await kv.get(`aibadges:latestVersion:${p}`))) {
      await kv.set(`aibadges:latestVersion:${p}`, legacyLatest);
      await kv.set(`aibadges:profile:${p}:${legacyLatest}`, raw);
      for (const k of ['signals', 'publishedStage', 'userKey'] as const) {
        const v = await kv.get(`aibadges:${k}`);
        if (v !== null && v !== undefined) await kv.set(`aibadges:${k}:${p}`, v);
      }
    }
  }
  await kv.set('aibadges:latestVersion', ''); // tombstone: migration ran
}
