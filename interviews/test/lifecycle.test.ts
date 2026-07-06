import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server";
import type { LlmClient } from "../src/llm/client";
import { makeStore, openDb } from "../src/store/db";

const vtt = readFileSync(join(import.meta.dir, "fixtures/sample.vtt"), "utf-8");

const fakeLlm: LlmClient = {
  complete: async () =>
    JSON.stringify({
      codes: [{ type: "PAIN", value: "3", quote: "We had nothing.", turnRef: 3, confidence: 0.9 }],
    }),
};

function makeApp() {
  return createApp({
    db: new Database(":memory:"),
    dataDir: mkdtempSync(join(tmpdir(), "interviews-test-")),
    llm: fakeLlm,
  });
}
const post = (app: any, p: string, b?: unknown) =>
  app.request(p, {
    method: "POST",
    headers: b ? { "content-type": "application/json" } : {},
    body: b ? JSON.stringify(b) : undefined,
  });
const del = (app: any, p: string) => app.request(p, { method: "DELETE" });

async function seed(app: any) {
  const p = (await (await post(app, "/api/participants", { profile: "C" })).json()) as any;
  const i = (await (await post(app, `/api/participants/${p.id}/interviews`, {})).json()) as any;
  const form = new FormData();
  form.append("file", new File([vtt], "call.vtt"));
  await app.request(`/api/interviews/${i.id}/transcript?manual=1`, { method: "POST", body: form });
  return { p, i };
}
async function runCoding(app: any, id: number) {
  await post(app, `/api/interviews/${id}/code`);
  for (let k = 0; k < 50; k++) {
    const s = (await (await app.request(`/api/interviews/${id}/coding-status`)).json()) as any;
    if (s.state !== "running") return s;
    await new Promise((r) => setTimeout(r, 15));
  }
}
const codes = async (app: any, id: number) =>
  ((await (await app.request(`/api/interviews/${id}`)).json()) as any).codes;

describe("undo and lifecycle", () => {
  it("re-running coding replaces pending suggestions instead of duplicating", async () => {
    const app = makeApp();
    const { i } = await seed(app);
    await runCoding(app, i.id);
    await runCoding(app, i.id);
    const all = await codes(app, i.id);
    expect(all.filter((c: any) => c.state === "ai_suggested").length).toBe(1);
  });

  it("a decided code can be returned to pending (undo)", async () => {
    const app = makeApp();
    const { i } = await seed(app);
    await runCoding(app, i.id);
    const [c] = await codes(app, i.id);
    await post(app, `/api/codes/${c.id}`, { state: "confirmed" });
    expect((await codes(app, i.id))[0].state).toBe("confirmed");
    await post(app, `/api/codes/${c.id}`, { state: "ai_suggested" });
    expect((await codes(app, i.id))[0].state).toBe("ai_suggested");
  });

  it("manual codes can be deleted; suggestions cannot", async () => {
    const app = makeApp();
    const { i } = await seed(app);
    await runCoding(app, i.id);
    await post(app, `/api/interviews/${i.id}/codes`, { type: "PARTIC", value: "high", quote: "q", turnRef: 0 });
    const all = await codes(app, i.id);
    const manual = all.find((c: any) => c.state === "manual");
    const suggested = all.find((c: any) => c.state === "ai_suggested");
    expect((await del(app, `/api/codes/${manual.id}`)).status).toBe(200);
    expect((await del(app, `/api/codes/${suggested.id}`)).status).toBe(400);
    expect((await codes(app, i.id)).length).toBe(1);
  });

  it("reviewed interviews can be reopened", async () => {
    const app = makeApp();
    const { i } = await seed(app);
    await post(app, `/api/interviews/${i.id}/review-done`);
    expect((await post(app, `/api/interviews/${i.id}/reopen`)).status).toBe(200);
    const d = (await (await app.request(`/api/interviews/${i.id}`)).json()) as any;
    expect(d.status).toBe("coded");
    // reopen twice is a 400, not a crash
    await post(app, `/api/interviews/${i.id}/reopen`);
    expect((await post(app, `/api/interviews/${i.id}/reopen`)).status).toBe(400);
  });

  it("deleting an interview cascades codes, notes, transcript", async () => {
    const app = makeApp();
    const { p, i } = await seed(app);
    await runCoding(app, i.id);
    await post(app, `/api/interviews/${i.id}/notes`, { text: "asked:op-rollout" });
    expect((await del(app, `/api/interviews/${i.id}`)).status).toBe(200);
    expect((await app.request(`/api/interviews/${i.id}`)).status).toBe(404);
    // participant survives
    const roster = (await (await app.request("/api/participants")).json()) as any[];
    expect(roster.length).toBe(1);
    expect(roster[0].id).toBe(p.id);
  });

  it("deleting a participant cascades their interviews", async () => {
    const app = makeApp();
    const { p, i } = await seed(app);
    expect((await del(app, `/api/participants/${p.id}`)).status).toBe(200);
    expect((await app.request(`/api/interviews/${i.id}`)).status).toBe(404);
    expect(((await (await app.request("/api/participants")).json()) as any[]).length).toBe(0);
  });

  it("notes can be deleted (un-ask in the live guide)", async () => {
    const app = makeApp();
    const { i } = await seed(app);
    await post(app, `/api/interviews/${i.id}/notes`, { text: "asked:op-rollout" });
    const d = (await (await app.request(`/api/interviews/${i.id}`)).json()) as any;
    expect(d.notes[0].id).toBeGreaterThan(0);
    await del(app, `/api/notes/${d.notes[0].id}`);
    const d2 = (await (await app.request(`/api/interviews/${i.id}`)).json()) as any;
    expect(d2.notes.length).toBe(0);
  });
});

describe("store cascade (direct)", () => {
  it("deleteParticipant leaves no orphan rows", () => {
    const store = makeStore(openDb(":memory:"));
    const p = store.createParticipant({ profile: "A", source: "", screener: {}, linkedinVerified: false });
    const i = store.createInterview(p.id);
    store.saveTranscript(i.id, "a.vtt", "raw", [{ i: 0, speaker: "S", text: "t" }]);
    store.insertCodes([{ interviewId: i.id, type: "PAIN", value: "2", quote: "q", turnRef: 0 }], "confirmed");
    store.saveNote(i.id, "n");
    store.deleteParticipant(p.id);
    expect(store.listParticipants().length).toBe(0);
    expect(store.listInterviews().length).toBe(0);
    expect(store.listCodes(i.id).length).toBe(0);
    expect(store.listNotes(i.id).length).toBe(0);
    expect(store.getTurns(i.id).length).toBe(0);
  });
});
