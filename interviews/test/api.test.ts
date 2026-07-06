import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server";
import type { LlmClient } from "../src/llm/client";

const vtt = readFileSync(join(import.meta.dir, "fixtures/sample.vtt"), "utf-8");

// Fake LLM grounded in the fixture's merged turns: after consecutive-speaker
// merging the CFO quote is turn 3 and the budget/pilot quotes are turn 5.
const fakeLlm: LlmClient = {
  complete: async () =>
    JSON.stringify({
      codes: [
        { type: "PAIN", value: "3", quote: "We had nothing.", turnRef: 3, confidence: 0.9 },
        { type: "COMMIT", value: "3", quote: "we'd pay for a pilot", turnRef: 5, confidence: 0.8 },
        { type: "BUYER", value: "vp engineering", quote: "That would be my budget, VP Engineering.", turnRef: 5, confidence: 0.85 },
      ],
    }),
};

function makeApp() {
  return createApp({
    db: new Database(":memory:"),
    dataDir: mkdtempSync(join(tmpdir(), "interviews-test-")),
    llm: fakeLlm,
  });
}

async function post(app: any, path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function waitForJob(app: any, id: number) {
  for (let i = 0; i < 50; i++) {
    const res = await app.request(`/api/interviews/${id}/coding-status`);
    const s = (await res.json()) as any;
    if (s.state === "done" || s.state === "error") return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("job never finished");
}

describe("API happy path", () => {
  it("participant → interview → upload → code → review → segments", async () => {
    const app = makeApp();

    const pRes = await post(app, "/api/participants", {
      profile: "C",
      source: "respondent",
      screener: { title: "VP Eng" },
      linkedinVerified: true,
    });
    expect(pRes.status).toBe(201);
    const p = (await pRes.json()) as any;
    expect(p.pseudonym).toBe("P1");

    const iRes = await post(app, `/api/participants/${p.id}/interviews`, {});
    const interview = (await iRes.json()) as any;

    const form = new FormData();
    form.append("file", new File([vtt], "call.vtt", { type: "text/vtt" }));
    const up = await app.request(`/api/interviews/${interview.id}/transcript`, {
      method: "POST",
      body: form,
    });
    expect(up.status).toBe(200);
    expect(((await up.json()) as any).turns).toBe(8);

    const job = await waitForJob(app, interview.id);
    expect(job.state).toBe("done");

    const detail = (await (await app.request(`/api/interviews/${interview.id}`)).json()) as any;
    expect(detail.status).toBe("coded");
    const suggested = detail.codes.filter((c: any) => c.state === "ai_suggested");
    expect(suggested.length).toBe(3);

    // confirm PAIN and COMMIT, reject BUYER, add PARTIC manually
    const byType = Object.fromEntries(suggested.map((c: any) => [c.type, c]));
    await post(app, `/api/codes/${byType.PAIN.id}`, { state: "confirmed" });
    await post(app, `/api/codes/${byType.COMMIT.id}`, { state: "confirmed" });
    await post(app, `/api/codes/${byType.BUYER.id}`, { state: "rejected" });
    await post(app, `/api/interviews/${interview.id}/codes`, {
      type: "PARTIC",
      value: "high",
      quote: "Maybe two thirds",
      turnRef: 7,
    });

    const done = await post(app, `/api/interviews/${interview.id}/review-done`);
    const seg = ((await done.json()) as any).segments;
    expect(seg.perProfile.C.verdict).toBe("INSUFFICIENT"); // n=1
    expect(seg.perProfile.C.metrics.n).toBe(1);
    expect(seg.perProfile.C.metrics.hasCommit3).toBe(true);
    expect(seg.perProfile.A.metrics.n).toBe(0);
  });

  it("bad upload rejected with a message; unparseable file is a 400", async () => {
    const app = makeApp();
    const p = (await (await post(app, "/api/participants", { profile: "A" })).json()) as any;
    const i = (await (await post(app, `/api/participants/${p.id}/interviews`, {})).json()) as any;
    const form = new FormData();
    form.append("file", new File(["no markers"], "x.txt"));
    const up = await app.request(`/api/interviews/${i.id}/transcript`, { method: "POST", body: form });
    expect(up.status).toBe(400);
    expect(((await up.json()) as any).error).toContain("No speaker turns");
  });

  it("LLM failure surfaces as job error, interview stays transcribed", async () => {
    const broken: LlmClient = { complete: async () => { throw new Error("HTTP 503"); } };
    const app = createApp({
      db: new Database(":memory:"),
      dataDir: mkdtempSync(join(tmpdir(), "interviews-test-")),
      llm: broken,
    });
    const p = (await (await post(app, "/api/participants", { profile: "B" })).json()) as any;
    const i = (await (await post(app, `/api/participants/${p.id}/interviews`, {})).json()) as any;
    const form = new FormData();
    form.append("file", new File([vtt], "call.vtt"));
    await app.request(`/api/interviews/${i.id}/transcript`, { method: "POST", body: form });
    const job = await waitForJob(app, i.id);
    // all chunks fail → suggestions empty but job completes with failedChunks
    expect(job.state).toBe("done");
    expect(job.failedChunks.length).toBeGreaterThan(0);
    const detail = (await (await app.request(`/api/interviews/${i.id}`)).json()) as any;
    expect(detail.codes.length).toBe(0);
  });

  it("kit endpoint serves the guide content", async () => {
    const app = makeApp();
    const kit = (await (await app.request("/api/kit")).json()) as any;
    expect(kit.stages.length).toBe(5);
    expect(kit.conceptBlock.steps.length).toBe(8);
    expect(kit.bankNote).toContain("bank, not a checklist");
  });
});
