import { describe, it, expect } from "bun:test";
import { CODEBOOK, isValidValue, toCodedInterview } from "../src/engine/codebook";

describe("codebook validation", () => {
  it("accepts valid values per type", () => {
    expect(isValidValue("PAIN", "2")).toBe(true);
    expect(isValidValue("PRIV_POST", "RED")).toBe(true);
    expect(isValidValue("PARTIC", "mixed")).toBe(true);
    expect(isValidValue("COMMIT", "3")).toBe(true);
    expect(isValidValue("SPEND", "true")).toBe(true);
    expect(isValidValue("BUYER", "Head of L&D")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isValidValue("PAIN", "4")).toBe(false);
    expect(isValidValue("PRIV_POST", "red")).toBe(false);
    expect(isValidValue("PARTIC", "maybe")).toBe(false);
    expect(isValidValue("SPEND", "yes")).toBe(false);
    expect(isValidValue("BUYER", "  ")).toBe(false);
  });

  it("has all 8 code types with descriptions", () => {
    expect(CODEBOOK.map((d) => d.type).sort()).toEqual(
      ["ALT", "BUYER", "COMMIT", "PAIN", "PARTIC", "PRIV_POST", "PRIV_PRE", "SPEND"],
    );
    for (const d of CODEBOOK) expect(d.description.length).toBeGreaterThan(20);
  });

  it("PAIN carries the H2 finance anchor with the 5-10x floor", () => {
    const pain = CODEBOOK.find((d) => d.type === "PAIN")!;
    expect(pain.anchors?.B).toContain("5 to 10x");
    expect(pain.anchors?.B).toContain("renewal decisions made blind");
  });
});

describe("toCodedInterview", () => {
  it("maps a mixed code list with defaults", () => {
    const coded = toCodedInterview(7, [
      { type: "PAIN", value: "3" },
      { type: "SPEND", value: "true" },
      { type: "BUYER", value: "CTO" },
      { type: "PRIV_PRE", value: "RED" },
      { type: "PRIV_POST", value: "AMBER" },
      { type: "PARTIC", value: "high" },
      { type: "COMMIT", value: "1" },
      { type: "COMMIT", value: "3" },
      { type: "COMMIT", value: "2" },
    ]);
    expect(coded).toEqual({
      interviewId: 7,
      pain: 3,
      spend: true,
      buyerRole: "cto",
      buyerCompeting: false,
      privPost: "AMBER",
      partic: "high",
      commit: 3, // highest rung wins
    });
  });

  it("defaults: no codes → commit 0, no spend, no competing buyer", () => {
    expect(toCodedInterview(1, [])).toEqual({
      interviewId: 1,
      spend: false,
      buyerCompeting: false,
      commit: 0,
    });
  });

  it("BUYER TRIANGLE marks competing owner", () => {
    const coded = toCodedInterview(2, [{ type: "BUYER", value: "TRIANGLE" }]);
    expect(coded.buyerCompeting).toBe(true);
    expect(coded.buyerRole).toBeUndefined();
  });
});
