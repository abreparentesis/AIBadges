import type { CodedInterview, Profile } from "./types";

/**
 * The decision rules from docs/research/b2b-validation-interviews.md §5,
 * implemented verbatim. Evaluation order is fixed: Kill → Pivot → Proceed →
 * Hold, so every segment lands in exactly one bucket. All thresholds are
 * proportions of completed interviews (n 5-8; below 5 → INSUFFICIENT).
 */
export type Verdict =
  | "KILL"
  | "PIVOT_PRIVACY"
  | "PIVOT_PARTICIPATION"
  | "PROCEED"
  | "HOLD"
  | "INSUFFICIENT";

export interface SegmentMetrics {
  n: number;
  /** % of interviews at pain severity ≥2 (undefined pain counts as not-≥2). */
  painRealPct: number;
  /** strictly more than 50% of interviews at severity ≤1 (or unscored). */
  painMostlyLE1: boolean;
  spendPct: number;
  commit2PlusPct: number;
  hasCommit3: boolean;
  privRedPct: number;
  particLowPct: number;
  buyerConsistent: boolean;
  buyerRole?: string;
}

export interface SegmentVerdict {
  verdict: Verdict;
  reasons: string[];
  metrics: SegmentMetrics;
}

const pct = (num: number, n: number) => (n === 0 ? 0 : (num / n) * 100);

export function computeMetrics(interviews: CodedInterview[]): SegmentMetrics {
  const n = interviews.length;
  const painReal = interviews.filter((i) => (i.pain ?? 0) >= 2).length;
  const painLE1 = interviews.filter((i) => (i.pain ?? 0) <= 1).length;
  const spend = interviews.filter((i) => i.spend).length;
  const commit2Plus = interviews.filter((i) => i.commit >= 2).length;
  const hasCommit3 = interviews.some((i) => i.commit === 3);
  const privRed = interviews.filter((i) => i.privPost === "RED").length;
  const particLow = interviews.filter((i) => i.partic === "low").length;

  // consistent BUYER = ≥50% of interviews name the same role AND no
  // interview names a competing owner (kit §5, single definition).
  const roleCounts = new Map<string, number>();
  for (const i of interviews) {
    if (i.buyerRole) roleCounts.set(i.buyerRole, (roleCounts.get(i.buyerRole) ?? 0) + 1);
  }
  let topRole: string | undefined;
  let topCount = 0;
  for (const [role, count] of roleCounts) {
    if (count > topCount) [topRole, topCount] = [role, count];
  }
  const anyCompeting = interviews.some((i) => i.buyerCompeting);
  const buyerConsistent = !anyCompeting && n > 0 && pct(topCount, n) >= 50;

  return {
    n,
    painRealPct: pct(painReal, n),
    painMostlyLE1: pct(painLE1, n) > 50,
    spendPct: pct(spend, n),
    commit2PlusPct: pct(commit2Plus, n),
    hasCommit3,
    privRedPct: pct(privRed, n),
    particLowPct: pct(particLow, n),
    buyerConsistent,
    buyerRole: buyerConsistent ? topRole : undefined,
  };
}

export function evaluateSegment(interviews: CodedInterview[]): SegmentVerdict {
  const m = computeMetrics(interviews);
  const r: string[] = [];

  if (m.n < 5) {
    return {
      verdict: "INSUFFICIENT",
      reasons: [`only ${m.n} reviewed interview(s); rules run at 5-8`],
      metrics: m,
    };
  }

  // 1. Kill
  if (m.painMostlyLE1) {
    r.push("pain is mostly severity ≤1");
    return { verdict: "KILL", reasons: r, metrics: m };
  }
  if (m.commit2PlusPct < 40 && !m.hasCommit3 && m.privRedPct < 50) {
    r.push(
      `COMMIT-2+ at ${m.commit2PlusPct.toFixed(0)}% (<40%) with no COMMIT-3, and privacy is not the blocker (PRIV-POST-RED ${m.privRedPct.toFixed(0)}% <50%)`,
    );
    return { verdict: "KILL", reasons: r, metrics: m };
  }

  // 2. Pivot
  const painReal = m.painRealPct >= 50;
  if (painReal && m.privRedPct >= 50) {
    r.push(
      `real pain (${m.painRealPct.toFixed(0)}% at ≥2) but PRIV-POST-RED covers ${m.privRedPct.toFixed(0)}%: rescope employee-opt-in, aggregate-only, re-test`,
    );
    return { verdict: "PIVOT_PRIVACY", reasons: r, metrics: m };
  }
  if (painReal && m.particLowPct >= 50) {
    r.push(
      `real pain but PARTIC mostly low (${m.particLowPct.toFixed(0)}%): rescope the collection model (org-deployed or automated), re-test`,
    );
    return { verdict: "PIVOT_PARTICIPATION", reasons: r, metrics: m };
  }

  // 3. Proceed
  if (
    painReal &&
    m.spendPct >= 40 &&
    m.buyerConsistent &&
    m.commit2PlusPct >= 40 &&
    m.hasCommit3 &&
    m.particLowPct < 50
  ) {
    r.push(
      `pain ${m.painRealPct.toFixed(0)}%, spend ${m.spendPct.toFixed(0)}%, buyer '${m.buyerRole}', COMMIT-2+ ${m.commit2PlusPct.toFixed(0)}% incl. a COMMIT-3`,
    );
    return { verdict: "PROCEED", reasons: r, metrics: m };
  }

  // 4. Hold
  if (!painReal) r.push("pain below the 50% bar");
  if (m.spendPct < 40) r.push(`spend evidence thin (${m.spendPct.toFixed(0)}%)`);
  if (!m.buyerConsistent) r.push("no consistent buyer");
  if (m.commit2PlusPct < 40) r.push(`COMMIT-2+ ${m.commit2PlusPct.toFixed(0)}% (<40%)`);
  if (!m.hasCommit3) r.push("no COMMIT-3 (no paid-pilot yes)");
  return { verdict: "HOLD", reasons: r, metrics: m };
}

/** Cross-segment H5 kill: true when NO segment surfaced a consistent buyer. */
export function crossSegmentKill(all: SegmentVerdict[]): boolean {
  const scored = all.filter((v) => v.verdict !== "INSUFFICIENT");
  return scored.length > 0 && scored.every((v) => !v.metrics.buyerConsistent);
}

/**
 * Rank PROCEED segments by pain severity × spend evidence × commitment rate.
 * avgPain is the mean severity over scored interviews, passed in by the caller.
 */
export function rankSegments(
  verdicts: Map<Profile, SegmentVerdict>,
  avgPain: Map<Profile, number>,
): Profile[] {
  return [...verdicts.entries()]
    .filter(([, v]) => v.verdict === "PROCEED")
    .sort(([pa, a], [pb, b]) => {
      const score = (p: Profile, v: SegmentVerdict) =>
        (avgPain.get(p) ?? 0) * v.metrics.spendPct * v.metrics.commit2PlusPct;
      return score(pb, b) - score(pa, a);
    })
    .map(([p]) => p);
}
