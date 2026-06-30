// Choose which conversations to analyze. The 7-day usage cap bounds how much we can
// evidence-extract per run, so rather than taking only the most-recent N (which makes the
// trajectory lens myopic), we sample evenly across the whole history — always keeping the
// oldest and newest — so the same budget buys real time-span. Input may be in any order;
// output is oldest-to-newest, which is what the evidence/trajectory steps expect.
export function selectAcrossTimeline<T extends { updatedAt: string }>(items: T[], max: number): T[] {
  const sorted = [...items].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)); // oldest -> newest
  if (max <= 0) return [];
  if (sorted.length <= max) return sorted;
  if (max === 1) return [sorted[sorted.length - 1]]; // newest

  const lastIdx = sorted.length - 1;
  const picked: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * lastIdx) / (max - 1)); // even spread incl. 0 (oldest) and lastIdx (newest)
    if (!seen.has(idx)) { seen.add(idx); picked.push(sorted[idx]); }
  }
  return picked;
}
