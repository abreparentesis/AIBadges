import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ParseError, parseTranscript } from "../src/ingest/parse";

const vtt = readFileSync(join(import.meta.dir, "fixtures/sample.vtt"), "utf-8");
const txt = readFileSync(join(import.meta.dir, "fixtures/sample.txt"), "utf-8");

describe("VTT parsing", () => {
  it("extracts speakers from voice tags and merges consecutive turns", () => {
    const turns = parseTranscript("sample.vtt", vtt);
    // 9 cues, P1's two consecutive cues merge → 8 turns
    expect(turns.length).toBe(8);
    expect(turns[0].speaker).toBe("Sebastian");
    expect(turns[1].speaker).toBe("P1");
    expect(turns[1].text).toContain("chaotic");
    expect(turns[1].text).toContain("Copilot about a year ago");
    expect(turns.every((t, i) => t.i === i)).toBe(true);
    expect(turns[0].start).toBe("00:01");
  });
});

describe("TXT parsing", () => {
  it("splits on 'Speaker:' prefixes with continuation lines", () => {
    const turns = parseTranscript("sample.txt", txt);
    expect(turns.length).toBe(6);
    expect(turns[1].speaker).toBe("P2");
    expect(turns[1].text).toContain("Trending up roughly 40 percent");
  });
});

describe("errors", () => {
  it("garbage input throws ParseError with a human message", () => {
    expect(() => parseTranscript("x.txt", "no speaker markers here\njust prose")).toThrow(ParseError);
  });
  it("empty vtt throws", () => {
    expect(() => parseTranscript("x.vtt", "WEBVTT\n\n")).toThrow(ParseError);
  });
});
