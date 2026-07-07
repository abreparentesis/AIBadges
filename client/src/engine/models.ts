// Choose an "extract" and a "best" model from the set the user actually has — never assume a
// tier. Ranking: haiku < sonnet < (unknown) < opus.
//
// Extraction is judgment work (which quotes evidence which fluency), not bulk transcription —
// Haiku under-mines reaction evidence, which starved bands on the Claude path relative to the
// ChatGPT path. So extraction prefers SONNET (capable + affordable); an account without Sonnet
// uses the best it has rather than dropping to Haiku. Synthesis/audit stay on best. Incremental
// extraction keeps the upgrade affordable: re-runs only extract changed conversations.
export function pickModels(available: Array<string | undefined | null>): { extract: string | null; best: string | null } {
  const uniq = [...new Set(available.filter((m): m is string => !!m))];
  if (uniq.length === 0) return { extract: null, best: null };
  const rank = (m: string) => {
    const s = m.toLowerCase();
    if (s.includes('haiku')) return 0;
    if (s.includes('sonnet')) return 1;
    if (s.includes('opus')) return 3;
    return 2;
  };
  const sorted = [...uniq].sort((a, b) => rank(a) - rank(b));
  const best = sorted[sorted.length - 1];
  const extract = sorted.find((m) => rank(m) === 1) ?? best;
  return { extract, best };
}
