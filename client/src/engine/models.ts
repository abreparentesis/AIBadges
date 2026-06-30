// Choose a "fast" (cheap, high-throughput) and a "best" (most capable) model from the set the
// user actually has — never assume a tier. Ranking: haiku < sonnet < opus < (unknown in between).
export function pickModels(available: Array<string | undefined | null>): { fast: string | null; best: string | null } {
  const uniq = [...new Set(available.filter((m): m is string => !!m))];
  if (uniq.length === 0) return { fast: null, best: null };
  const rank = (m: string) => {
    const s = m.toLowerCase();
    if (s.includes('haiku')) return 0;
    if (s.includes('sonnet')) return 1;
    if (s.includes('opus')) return 3;
    return 2;
  };
  const sorted = [...uniq].sort((a, b) => rank(a) - rank(b));
  return { fast: sorted[0], best: sorted[sorted.length - 1] };
}
