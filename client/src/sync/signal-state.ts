import type { Signal } from '../engine/types';

/**
 * A run rewrites its provider's stored signals from a fresh distill — but publishing is USER
 * state, not run output. Without this carry-over every re-run silently flipped the badge back to
 * private, so the share section kept "forgetting" it was published while the server page stayed
 * live with stale content. The shareToken rides along so the UI keeps showing the same URL the
 * server will keep honoring (tokens are stable per user+type).
 */
export type StoredSignal = Signal & { shareToken?: string | null };

export function carryOverSharing(prevRaw: string | null | undefined, fresh: Signal[]): StoredSignal[] {
  let prev: StoredSignal[] = [];
  try {
    const parsed = prevRaw ? JSON.parse(prevRaw) : [];
    if (Array.isArray(parsed)) prev = parsed as StoredSignal[];
  } catch { /* corrupt previous state -> fresh (private) defaults */ }
  const byType = new Map(prev.map((s) => [s.type, s]));
  return fresh.map((s) => {
    const old = byType.get(s.type);
    if (!old || old.disclosure !== 'public') return s;
    return { ...s, disclosure: 'public', shareToken: old.shareToken ?? null };
  });
}
