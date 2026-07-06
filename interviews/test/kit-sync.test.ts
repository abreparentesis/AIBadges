import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The engine hard-codes the kit's thresholds. If the kit doc changes its
 * numbers, this test fails and forces a deliberate engine review — the doc
 * stays the source of truth.
 */
const doc = readFileSync(
  join(import.meta.dir, "../../docs/research/b2b-validation-interviews.md"),
  "utf-8",
);

describe("engine thresholds still match the kit doc", () => {
  const literals = [
    "≥50% at severity ≥2", // pain-real bar (Pivot/Proceed)
    "≥40% show", // SPEND gate
    "≥40% reach COMMIT-2+", // Proceed commitment gate
    "under 40% with no", // Kill commitment clause
    "PRIV-POST-RED covers ≥50%", // privacy Pivot bar
    "≥50% of its", // consistent-BUYER definition
    "5 to 8 per segment", // rule-evaluation sample range
    "Kill, then Pivot, then Proceed, then Hold", // evaluation order
  ];
  for (const lit of literals) {
    it(`doc contains: "${lit}"`, () => {
      expect(doc.includes(lit)).toBe(true);
    });
  }
});
