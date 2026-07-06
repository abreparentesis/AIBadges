import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCodedInterview } from "../engine/codebook";
import {
  BANK_NOTE,
  CONCEPT_BLOCK,
  OPENER,
  PROFILE_LABELS,
  QUESTION_BANK,
  SCREENERS,
  STAGES,
} from "../engine/kit";
import type { Profile } from "../engine/types";
import { ParseError, parseTranscript } from "../ingest/parse";
import { codeTranscript } from "../llm/coder";
import type { LlmClient } from "../llm/client";
import { buildFacts, draftSynthesis, finalReport } from "../reports/synthesis";
import type { Store } from "../store/db";
import { PROFILES, segmentVerdicts } from "./segments";

export type JobState = "running" | "done" | "error";

export interface ApiDeps {
  store: Store;
  dataDir: string;
  llm: LlmClient;
}

export function mountApi(app: Hono, deps: ApiDeps) {
  const { store, dataDir, llm } = deps;
  const jobs = new Map<number, { state: JobState; error?: string; failedChunks?: number[] }>();

  async function runCodingJob(interviewId: number): Promise<void> {
    jobs.set(interviewId, { state: "running" });
    try {
      const interview = store.getInterview(interviewId);
      if (!interview) throw new Error("interview not found");
      const participant = store.getParticipant(interview.participantId)!;
      const turns = store.getTurns(interviewId);
      if (turns.length === 0) throw new Error("no transcript");
      const { suggestions, failedChunks } = await codeTranscript(turns, participant.profile, llm);
      store.insertCodes(
        suggestions.map((s) => ({
          interviewId,
          type: s.type,
          value: s.value,
          quote: s.quote,
          turnRef: s.turnRef,
          confidence: s.confidence,
        })),
        "ai_suggested",
      );
      store.setInterviewStatus(interviewId, "coded");
      jobs.set(interviewId, { state: "done", failedChunks });
    } catch (e) {
      jobs.set(interviewId, { state: "error", error: (e as Error).message });
    }
  }

  app.get("/api/kit", (c) =>
    c.json({
      stages: STAGES,
      opener: OPENER,
      questionBank: QUESTION_BANK,
      conceptBlock: CONCEPT_BLOCK,
      screeners: SCREENERS,
      profileLabels: PROFILE_LABELS,
      bankNote: BANK_NOTE,
    }),
  );

  app.get("/api/participants", (c) => c.json(store.listParticipants()));

  app.post("/api/participants", async (c) => {
    const b = await c.req.json();
    if (!PROFILES.includes(b.profile)) return c.json({ error: "profile must be A|B|C" }, 400);
    const p = store.createParticipant({
      profile: b.profile,
      source: b.source ?? "",
      screener: b.screener ?? {},
      linkedinVerified: !!b.linkedinVerified,
    });
    return c.json(p, 201);
  });

  app.post("/api/participants/:id/interviews", async (c) => {
    const pid = Number(c.req.param("id"));
    if (!store.getParticipant(pid)) return c.json({ error: "participant not found" }, 404);
    const b = await c.req.json().catch(() => ({}));
    return c.json(store.createInterview(pid, b.scheduledAt), 201);
  });

  app.get("/api/interviews", (c) => {
    const items = store.listInterviews().map((i) => ({
      ...i,
      participant: store.getParticipant(i.participantId),
    }));
    return c.json(items);
  });

  app.get("/api/interviews/:id", (c) => {
    const id = Number(c.req.param("id"));
    const interview = store.getInterview(id);
    if (!interview) return c.json({ error: "not found" }, 404);
    return c.json({
      ...interview,
      participant: store.getParticipant(interview.participantId),
      turns: store.getTurns(id),
      codes: store.listCodes(id),
      notes: store.listNotes(id),
      job: jobs.get(id) ?? null,
    });
  });

  app.post("/api/interviews/:id/transcript", async (c) => {
    const id = Number(c.req.param("id"));
    const interview = store.getInterview(id);
    if (!interview) return c.json({ error: "not found" }, 404);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "multipart field 'file' required" }, 400);
    const content = await file.text();
    let turns;
    try {
      turns = parseTranscript(file.name, content);
    } catch (e) {
      if (e instanceof ParseError) return c.json({ error: e.message }, 400);
      throw e;
    }
    const uploads = join(dataDir, "uploads");
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, `${id}-${file.name.replace(/[^\w.-]/g, "_")}`), content);
    store.saveTranscript(id, file.name, content, turns);
    store.setInterviewStatus(id, "transcribed");
    const manual = c.req.query("manual") === "1";
    if (!manual) void runCodingJob(id);
    return c.json({ ok: true, turns: turns.length, coding: !manual });
  });

  app.post("/api/interviews/:id/code", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getInterview(id)) return c.json({ error: "not found" }, 404);
    void runCodingJob(id);
    return c.json({ ok: true });
  });

  app.get("/api/interviews/:id/coding-status", (c) => {
    const id = Number(c.req.param("id"));
    return c.json(jobs.get(id) ?? { state: "idle" });
  });

  app.post("/api/codes/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    if (!["confirmed", "rejected", "edited"].includes(b.state)) {
      return c.json({ error: "state must be confirmed|rejected|edited" }, 400);
    }
    store.setCodeState(id, b.state, b.value);
    return c.json({ ok: true });
  });

  app.post("/api/interviews/:id/codes", async (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getInterview(id)) return c.json({ error: "not found" }, 404);
    const b = await c.req.json();
    store.insertCodes(
      [{ interviewId: id, type: b.type, value: b.value, quote: b.quote ?? "", turnRef: b.turnRef ?? 0 }],
      "manual",
    );
    return c.json({ ok: true }, 201);
  });

  app.post("/api/interviews/:id/review-done", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getInterview(id)) return c.json({ error: "not found" }, 404);
    store.setInterviewStatus(id, "reviewed");
    return c.json({ ok: true, segments: segmentVerdicts(store) });
  });

  app.post("/api/interviews/:id/notes", async (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getInterview(id)) return c.json({ error: "not found" }, 404);
    const b = await c.req.json();
    store.saveNote(id, String(b.text ?? ""));
    return c.json({ ok: true }, 201);
  });

  app.get("/api/segments", (c) => c.json(segmentVerdicts(store)));

  app.get("/api/reports/segment/:profile", async (c) => {
    const profile = c.req.param("profile") as Profile;
    if (!PROFILES.includes(profile)) return c.json({ error: "profile must be A|B|C" }, 400);
    const md = await draftSynthesis(buildFacts(profile, store), llm);
    return c.text(md, 200, { "content-type": "text/markdown; charset=utf-8" });
  });

  app.get("/api/reports/final", async (c) => {
    const md = await finalReport(store, llm);
    return c.text(md, 200, { "content-type": "text/markdown; charset=utf-8" });
  });
}
