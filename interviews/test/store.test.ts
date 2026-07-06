import { describe, it, expect } from "bun:test";
import { makeStore, openDb } from "../src/store/db";

function freshStore() {
  return makeStore(openDb(":memory:"));
}

describe("store", () => {
  it("participants get sequential pseudonyms and round-trip screener JSON", () => {
    const store = freshStore();
    const p1 = store.createParticipant({
      profile: "A",
      source: "respondent",
      screener: { title: "Head of L&D", company: "500 employees" },
      linkedinVerified: true,
    });
    const p2 = store.createParticipant({
      profile: "B",
      source: "userinterviews",
      screener: {},
      linkedinVerified: false,
    });
    expect(p1.pseudonym).toBe("P1");
    expect(p2.pseudonym).toBe("P2");
    expect(store.getParticipant(p1.id)?.screener.title).toBe("Head of L&D");
    expect(store.listParticipants().length).toBe(2);
  });

  it("interview status transitions persist", () => {
    const store = freshStore();
    const p = store.createParticipant({ profile: "C", source: "", screener: {}, linkedinVerified: false });
    const i = store.createInterview(p.id, "2026-07-10T10:00:00Z");
    expect(i.status).toBe("scheduled");
    store.setInterviewStatus(i.id, "transcribed");
    expect(store.getInterview(i.id)?.status).toBe("transcribed");
    expect(store.interviewsByProfile("C").length).toBe(1);
    expect(store.interviewsByProfile("A").length).toBe(0);
  });

  it("transcript round-trips turns and upserts", () => {
    const store = freshStore();
    const p = store.createParticipant({ profile: "A", source: "", screener: {}, linkedinVerified: false });
    const i = store.createInterview(p.id);
    const turns = [{ i: 0, speaker: "P1", text: "hello" }];
    store.saveTranscript(i.id, "a.vtt", "raw", turns);
    store.saveTranscript(i.id, "b.vtt", "raw2", turns); // upsert, no throw
    expect(store.getTurns(i.id)).toEqual(turns);
  });

  it("code lifecycle: suggest → confirm/reject/edit → effectiveCodes filters", () => {
    const store = freshStore();
    const p = store.createParticipant({ profile: "B", source: "", screener: {}, linkedinVerified: false });
    const i = store.createInterview(p.id);
    store.insertCodes(
      [
        { interviewId: i.id, type: "PAIN", value: "2", quote: "q1", turnRef: 0, confidence: 0.9 },
        { interviewId: i.id, type: "COMMIT", value: "2", quote: "q2", turnRef: 1, confidence: 0.7 },
        { interviewId: i.id, type: "SPEND", value: "true", quote: "q3", turnRef: 2, confidence: 0.8 },
      ],
      "ai_suggested",
    );
    const codes = store.listCodes(i.id);
    expect(codes.length).toBe(3);
    store.setCodeState(codes[0].id, "confirmed");
    store.setCodeState(codes[1].id, "edited", "3");
    store.setCodeState(codes[2].id, "rejected");
    store.insertCodes(
      [{ interviewId: i.id, type: "BUYER", value: "cfo", quote: "manual", turnRef: 3 }],
      "manual",
    );
    const effective = store.effectiveCodes(i.id);
    expect(effective.map((c) => [c.type, c.value])).toEqual([
      ["PAIN", "2"],
      ["COMMIT", "3"],
      ["BUYER", "cfo"],
    ]);
  });

  it("notes and llm log insert without error", () => {
    const store = freshStore();
    const p = store.createParticipant({ profile: "A", source: "", screener: {}, linkedinVerified: false });
    const i = store.createInterview(p.id);
    store.saveNote(i.id, "asked:op-rollout");
    expect(store.listNotes(i.id)[0].text).toBe("asked:op-rollout");
    store.logLlmCall({ purpose: "code", promptHash: "abc", ms: 1200, ok: true });
  });
});
