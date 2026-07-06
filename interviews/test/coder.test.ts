import { describe, it, expect } from "bun:test";
import { chunkTurns, codeTranscript } from "../src/llm/coder";
import type { LlmClient } from "../src/llm/client";
import type { Turn } from "../src/ingest/parse";

const turns: Turn[] = [
  { i: 0, speaker: "Sebastian", text: "How did AI get rolled out here?" },
  { i: 1, speaker: "P1", text: "Our CFO asked exactly that in March. We had nothing." },
  { i: 2, speaker: "P1", text: "we'd pay for a pilot if the data looks real" },
];

/** Client that returns scripted responses in order. */
function scripted(...responses: string[]): LlmClient {
  let n = 0;
  return { complete: async () => responses[Math.min(n++, responses.length - 1)] };
}

const goodJson = JSON.stringify({
  codes: [
    { type: "PAIN", value: "3", quote: "We had nothing.", turnRef: 1, confidence: 0.9 },
    { type: "COMMIT", value: "3", quote: "we'd pay for a pilot", turnRef: 2, confidence: 0.8 },
  ],
});

describe("codeTranscript", () => {
  it("valid JSON path yields suggestions", async () => {
    const { suggestions, failedChunks } = await codeTranscript(turns, "B", scripted(goodJson));
    expect(failedChunks).toEqual([]);
    expect(suggestions.map((s) => s.type).sort()).toEqual(["COMMIT", "PAIN"]);
  });

  it("invalid-then-valid retry path succeeds", async () => {
    const { suggestions, failedChunks } = await codeTranscript(
      turns,
      "B",
      scripted("not json at all", goodJson),
    );
    expect(failedChunks).toEqual([]);
    expect(suggestions.length).toBe(2);
  });

  it("always-invalid marks the chunk failed, never throws", async () => {
    const { suggestions, failedChunks } = await codeTranscript(turns, "B", scripted("{", "{"));
    expect(suggestions).toEqual([]);
    expect(failedChunks).toEqual([0]);
  });

  it("hallucinated quote (not a substring of the turn) is rejected", async () => {
    const bad = JSON.stringify({
      codes: [{ type: "PAIN", value: "3", quote: "totally invented words", turnRef: 1, confidence: 0.9 }],
    });
    const { suggestions, failedChunks } = await codeTranscript(turns, "B", scripted(bad, bad));
    expect(suggestions).toEqual([]);
    expect(failedChunks).toEqual([0]); // all suggestions invalid → error round → retry → failed
  });

  it("invalid value for type is rejected but valid siblings survive", async () => {
    const mixed = JSON.stringify({
      codes: [
        { type: "PAIN", value: "9", quote: "We had nothing.", turnRef: 1, confidence: 0.9 },
        { type: "COMMIT", value: "3", quote: "we'd pay for a pilot", turnRef: 2, confidence: 0.8 },
      ],
    });
    const { suggestions } = await codeTranscript(turns, "B", scripted(mixed));
    expect(suggestions.map((s) => s.type)).toEqual(["COMMIT"]);
  });

  it("LLM error marks chunk failed instead of throwing", async () => {
    const err: LlmClient = { complete: async () => { throw new Error("HTTP 500"); } };
    const { failedChunks } = await codeTranscript(turns, "B", err);
    expect(failedChunks).toEqual([0]);
  });
});

describe("chunkTurns", () => {
  it("respects maxChars and overlaps 2 turns", () => {
    const many: Turn[] = Array.from({ length: 10 }, (_, i) => ({
      i,
      speaker: "S",
      text: "x".repeat(100),
    }));
    const chunks = chunkTurns(many, 350);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk after the first starts with the previous chunk's last 2 turns
    for (let c = 1; c < chunks.length; c++) {
      const prev = chunks[c - 1];
      expect(chunks[c][0].i).toBe(prev[prev.length - 2].i);
      expect(chunks[c][1].i).toBe(prev[prev.length - 1].i);
    }
    // no turn lost
    const covered = new Set(chunks.flat().map((t) => t.i));
    expect(covered.size).toBe(10);
  });

  it("dedupes suggestions produced twice via overlap", async () => {
    const many: Turn[] = [
      { i: 0, speaker: "P1", text: "Our CFO asked exactly that in March." },
      { i: 1, speaker: "P1", text: "filler ".repeat(30) },
      { i: 2, speaker: "P1", text: "more filler ".repeat(30) },
    ];
    const dup = JSON.stringify({
      codes: [{ type: "PAIN", value: "2", quote: "Our CFO asked", turnRef: 0, confidence: 0.5 }],
    });
    // small maxChars forces 2 chunks; both scripted to return the same code for turn 0
    const client: LlmClient = { complete: async () => dup };
    const chunks = chunkTurns(many, 260);
    expect(chunks.length).toBeGreaterThan(1);
    const { suggestions } = await codeTranscript(many, "A", client);
    const painCodes = suggestions.filter((s) => s.type === "PAIN");
    expect(painCodes.length).toBe(1);
  });
});
