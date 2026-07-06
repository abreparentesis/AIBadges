import { describe, it, expect } from "bun:test";
import {
  BANK_NOTE,
  CONCEPT_BLOCK,
  OPENER,
  PROFILE_LABELS,
  QUESTION_BANK,
  SCREENERS,
  STAGES,
} from "../src/engine/kit";

describe("kit structure", () => {
  it("stages cover the 45-50 minute frame", () => {
    const min = STAGES.reduce((s, x) => s + x.minMinutes, 0);
    expect(min).toBeGreaterThanOrEqual(42);
    expect(STAGES.map((s) => s.id)).toEqual([
      "context",
      "pain",
      "alternatives",
      "concept",
      "close",
    ]);
  });

  it("concept block steps are in the kit's fixed order", () => {
    expect(CONCEPT_BLOCK.steps.map((s) => s.id)).toEqual([
      "first-reaction",
      "month-one",
      "priv-pre",
      "priv-post",
      "partic-1",
      "partic-2",
      "buyer",
      "commit-ladder",
    ]);
  });

  it("the pitch does not lead the privacy witness", () => {
    const p = CONCEPT_BLOCK.pitch.toLowerCase();
    expect(p).not.toContain("privacy");
    expect(p).not.toContain("raw conversations");
    expect(p).not.toContain("never leave");
  });

  it("every profile has an opener, ≥5 bank questions, screeners, label", () => {
    expect(OPENER.length).toBe(3);
    for (const profile of ["A", "B", "C"] as const) {
      expect(QUESTION_BANK[profile].length).toBeGreaterThanOrEqual(5);
      expect(SCREENERS[profile].length).toBeGreaterThanOrEqual(3);
      expect(PROFILE_LABELS[profile].length).toBeGreaterThan(3);
    }
  });

  it("probe steps feed the codes the rules consume", () => {
    const coded = CONCEPT_BLOCK.steps.flatMap((s) => s.codes);
    for (const t of ["PRIV_PRE", "PRIV_POST", "PARTIC", "BUYER", "COMMIT"]) {
      expect(coded).toContain(t);
    }
    expect(BANK_NOTE).toContain("bank, not a checklist");
  });
});
