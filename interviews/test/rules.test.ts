import { describe, it, expect } from "bun:test";
import type { CodedInterview, Profile } from "../src/engine/types";
import {
  computeMetrics,
  crossSegmentKill,
  evaluateSegment,
  rankSegments,
  type SegmentVerdict,
} from "../src/engine/rules";

let nextId = 1;
function mk(o: Partial<CodedInterview> = {}): CodedInterview {
  return {
    interviewId: nextId++,
    pain: 2,
    spend: true,
    buyerRole: "cto",
    buyerCompeting: false,
    privPost: "GREEN",
    partic: "high",
    commit: 2,
    ...o,
  };
}
/** n interviews, first k get `first`, rest get `rest`. */
function seg(n: number, k: number, first: Partial<CodedInterview>, rest: Partial<CodedInterview> = {}) {
  return Array.from({ length: n }, (_, i) => mk(i < k ? first : rest));
}

describe("sample-size gate", () => {
  it("n=4 → INSUFFICIENT", () => {
    expect(evaluateSegment(seg(4, 0, {})).verdict).toBe("INSUFFICIENT");
  });
  it("n=5 uniformly negative (early stop) → KILL", () => {
    expect(evaluateSegment(seg(5, 5, { pain: 1 })).verdict).toBe("KILL");
  });
});

describe("Kill boundaries", () => {
  it("pain at exactly 50% ≥2 (3 of 6) does NOT trigger 'mostly ≤1'", () => {
    const m = computeMetrics(seg(6, 3, { pain: 3 }, { pain: 1 }));
    expect(m.painMostlyLE1).toBe(false);
    expect(m.painRealPct).toBe(50);
  });
  it("one curiosity COMMIT-2 cannot veto a Kill (proportional bar)", () => {
    // 8 interviews, real pain avoided? No — weak commitment case: pain strong,
    // 1 of 8 at COMMIT-2 (12.5% < 40%), no COMMIT-3, PRIV-RED low → KILL.
    const s = seg(8, 1, { commit: 2 }, { commit: 1 });
    expect(evaluateSegment(s).verdict).toBe("KILL");
  });
  it("privacy guard: strong pain + PRIV-RED 60% + weak commitment → PIVOT_PRIVACY, not KILL", () => {
    const s = seg(5, 3, { privPost: "RED", commit: 0 }, { commit: 0 });
    expect(evaluateSegment(s).verdict).toBe("PIVOT_PRIVACY");
  });
  it("no guard: strong pain + PRIV-RED 40% + weak commitment → KILL", () => {
    const s = seg(5, 2, { privPost: "RED", commit: 0 }, { commit: 0 });
    expect(evaluateSegment(s).verdict).toBe("KILL");
  });
});

describe("Pivot boundaries", () => {
  it("PRIV-RED at exactly 50% (4 of 8) → PIVOT_PRIVACY", () => {
    const s = seg(8, 4, { privPost: "RED" });
    expect(evaluateSegment(s).verdict).toBe("PIVOT_PRIVACY");
  });
  it("PRIV-RED below 50% (3 of 8) falls through to PROCEED when strong", () => {
    const s = seg(8, 3, { privPost: "RED" }, { commit: 3 });
    expect(evaluateSegment(s).verdict).toBe("PROCEED");
  });
  it("participation pivot fires whatever the other bars say (thin spend, no buyer)", () => {
    const s = seg(6, 3, { partic: "low", spend: false, buyerRole: undefined });
    expect(evaluateSegment(s).verdict).toBe("PIVOT_PARTICIPATION");
  });
  it("would-Proceed segment failing only on PARTIC → PIVOT_PARTICIPATION, never Hold", () => {
    const s = seg(6, 3, { partic: "low", commit: 3 }, { commit: 3 });
    expect(evaluateSegment(s).verdict).toBe("PIVOT_PARTICIPATION");
  });
  it("privacy pivot outranks participation pivot when both fire", () => {
    const s = seg(6, 3, { privPost: "RED", partic: "low" }, { partic: "low" });
    expect(evaluateSegment(s).verdict).toBe("PIVOT_PRIVACY");
  });
});

describe("Proceed boundaries", () => {
  it("COMMIT-2+ at exactly 40% (2 of 5, one C3) with all bars → PROCEED", () => {
    const s = [
      mk({ commit: 3 }),
      mk({ commit: 2 }),
      mk({ commit: 1 }),
      mk({ commit: 0 }),
      mk({ commit: 1 }),
    ];
    const v = evaluateSegment(s);
    expect(v.metrics.commit2PlusPct).toBe(40);
    expect(v.verdict).toBe("PROCEED");
  });
  it("all bars except COMMIT-3 → HOLD (prototype interest is curiosity)", () => {
    const s = seg(6, 6, { commit: 2 });
    expect(evaluateSegment(s).verdict).toBe("HOLD");
  });
  it("all bars except spend (20%) → HOLD (the kit's typical Hold)", () => {
    const s = seg(5, 1, { spend: true, commit: 3 }, { spend: false, commit: 2 });
    expect(evaluateSegment(s).verdict).toBe("HOLD");
  });
});

describe("buyer consistency", () => {
  it("2/2/2 role split → not consistent → HOLD not PROCEED", () => {
    const s = [
      mk({ buyerRole: "cto", commit: 3 }),
      mk({ buyerRole: "cto" }),
      mk({ buyerRole: "cfo" }),
      mk({ buyerRole: "cfo" }),
      mk({ buyerRole: "chro" }),
      mk({ buyerRole: "chro" }),
    ];
    const v = evaluateSegment(s);
    expect(v.metrics.buyerConsistent).toBe(false);
    expect(v.verdict).toBe("HOLD");
  });
  it("any competing owner (TRIANGLE) breaks consistency", () => {
    const s = seg(6, 1, { buyerCompeting: true }, { commit: 3 });
    expect(evaluateSegment(s).metrics.buyerConsistent).toBe(false);
  });
  it("≥50% same role with no competitor is consistent", () => {
    const m = computeMetrics(seg(6, 3, { buyerRole: "cfo" }, { buyerRole: undefined }));
    expect(m.buyerConsistent).toBe(true);
    expect(m.buyerRole).toBe("cfo");
  });
});

describe("cross-segment H5 kill and ranking", () => {
  const proceed = (over: Partial<CodedInterview> = {}) =>
    evaluateSegment(seg(6, 6, { commit: 3, ...over }));
  it("kill when no segment has a consistent buyer", () => {
    const noBuyer = evaluateSegment(seg(6, 6, { buyerRole: undefined }));
    expect(crossSegmentKill([noBuyer, noBuyer, noBuyer])).toBe(true);
  });
  it("no kill when one segment has a buyer", () => {
    const noBuyer = evaluateSegment(seg(6, 6, { buyerRole: undefined }));
    expect(crossSegmentKill([proceed(), noBuyer])).toBe(false);
  });
  it("INSUFFICIENT segments don't count either way", () => {
    const insuf = evaluateSegment(seg(2, 2, {}));
    expect(crossSegmentKill([insuf])).toBe(false);
  });
  it("ranks PROCEED segments only, by pain*spend*commit", () => {
    const verdicts = new Map<Profile, SegmentVerdict>([
      ["A", proceed()],
      ["B", proceed()],
      ["C", evaluateSegment(seg(6, 6, { commit: 2 }))], // HOLD
    ]);
    const ranked = rankSegments(
      verdicts,
      new Map([
        ["A", 2.0],
        ["B", 2.8],
        ["C", 3.0],
      ]),
    );
    expect(ranked).toEqual(["B", "A"]);
  });
});
