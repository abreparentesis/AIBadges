import { describe, it, expect } from "bun:test";
import { makeStore, openDb } from "../src/store/db";
import { buildFacts, draftSynthesis, finalReport, verifyNumbers } from "../src/reports/synthesis";
import type { LlmClient } from "../src/llm/client";

function seededStore() {
  const store = makeStore(openDb(":memory:"));
  for (let k = 0; k < 5; k++) {
    const p = store.createParticipant({ profile: "B", source: "respondent", screener: {}, linkedinVerified: true });
    const i = store.createInterview(p.id);
    store.saveTranscript(i.id, "t.vtt", "raw", [{ i: 0, speaker: "P", text: "quote source" }]);
    store.insertCodes(
      [
        { interviewId: i.id, type: "PAIN", value: k < 3 ? "3" : "1", quote: `pain quote ${k}`, turnRef: 0 },
        { interviewId: i.id, type: "SPEND", value: "true", quote: `spend quote ${k}`, turnRef: 0 },
        { interviewId: i.id, type: "BUYER", value: "cfo", quote: "my budget", turnRef: 0 },
        { interviewId: i.id, type: "COMMIT", value: k === 0 ? "3" : "2", quote: "pilot", turnRef: 0 },
        { interviewId: i.id, type: "PRIV_PRE", value: "RED", quote: "legal would object", turnRef: 0 },
        { interviewId: i.id, type: "PRIV_POST", value: "AMBER", quote: "that helps", turnRef: 0 },
        { interviewId: i.id, type: "PARTIC", value: "high", quote: "most would", turnRef: 0 },
        { interviewId: i.id, type: "ALT", value: "current", quote: "we use a spreadsheet", turnRef: 0 },
      ],
      "confirmed",
    );
    store.setInterviewStatus(i.id, "reviewed");
  }
  return store;
}

const echoLlm: LlmClient = {
  complete: async ({ user }) => `Summary drafted from: ${user.slice(0, 400)}`,
};
const brokenLlm: LlmClient = { complete: async () => { throw new Error("down"); } };

describe("reports", () => {
  it("buildFacts computes histograms and pre/post privacy from confirmed codes", () => {
    const f = buildFacts("B", seededStore());
    expect(f.verdict.metrics.n).toBe(5);
    expect(f.severityHistogram).toEqual([0, 2, 0, 3]); // 3× sev3, 2× sev1
    expect(f.commitDistribution).toEqual([0, 0, 4, 1]);
    expect(f.privPre.RED).toBe(5);
    expect(f.privPost.AMBER).toBe(5);
    expect(f.partic.high).toBe(5);
    expect(f.buyerRole).toBe("cfo");
    expect(f.verdict.verdict).toBe("PROCEED");
    expect(f.topQuotes.length).toBe(3);
    expect(f.alternatives[0].quote).toBe("we use a spreadsheet");
  });

  it("verifyNumbers catches an altered percentage", () => {
    const f = buildFacts("B", seededStore());
    const missing = verifyNumbers(f, "The segment showed 61% pain and nothing else.");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).toContain("60"); // painRealPct is 60
  });

  it("draft includes facts block; numbers verified against facts+prose", async () => {
    const f = buildFacts("B", seededStore());
    const md = await draftSynthesis(f, echoLlm);
    expect(md).toContain("Verdict: PROCEED");
    expect(md).toContain("60% at ≥2");
    expect(md).not.toContain("⚠"); // facts block itself carries every number
  });

  it("LLM down → facts still render with a note", async () => {
    const f = buildFacts("B", seededStore());
    const md = await draftSynthesis(f, brokenLlm);
    expect(md).toContain("Prose unavailable");
    expect(md).toContain("Verdict: PROCEED");
  });

  it("final report includes all three segments and no cross-kill when a buyer exists", async () => {
    const md = await finalReport(seededStore(), echoLlm);
    expect(md).toContain("Segment A");
    expect(md).toContain("Segment B");
    expect(md).toContain("Segment C");
    expect(md).not.toContain("Cross-segment kill");
    expect(md).toContain("Build order");
    expect(md).toContain("B (Finance)");
  });

  it("cross-segment kill banner appears when no consistent buyer anywhere", async () => {
    const store = makeStore(openDb(":memory:"));
    for (let k = 0; k < 5; k++) {
      const p = store.createParticipant({ profile: "A", source: "", screener: {}, linkedinVerified: false });
      const i = store.createInterview(p.id);
      store.insertCodes(
        [
          { interviewId: i.id, type: "PAIN", value: "2", quote: "q", turnRef: 0 },
          { interviewId: i.id, type: "BUYER", value: "TRIANGLE", quote: "HR wants it but IT pays", turnRef: 0 },
        ],
        "confirmed",
      );
      store.setInterviewStatus(i.id, "reviewed");
    }
    const md = await finalReport(store, echoLlm);
    expect(md).toContain("Cross-segment kill");
  });
});
