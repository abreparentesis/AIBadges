import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeType, Profile } from "../engine/types";
import type { Turn } from "../ingest/parse";

export interface Participant {
  id: number;
  pseudonym: string;
  profile: Profile;
  source: string;
  screener: Record<string, string>;
  linkedinVerified: boolean;
}

export type InterviewStatus =
  | "scheduled"
  | "done"
  | "transcribed"
  | "coded"
  | "reviewed";

export interface Interview {
  id: number;
  participantId: number;
  scheduledAt?: string;
  status: InterviewStatus;
}

export type CodeState = "ai_suggested" | "confirmed" | "rejected" | "edited" | "manual";

export interface CodeRow {
  id: number;
  interviewId: number;
  type: CodeType;
  value: string;
  quote: string;
  turnRef: number;
  confidence?: number;
  state: CodeState;
}

export function initSchema(db: Database): Database {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(join(import.meta.dir, "schema.sql"), "utf-8"));
  return db;
}

export function openDb(path: string): Database {
  return initSchema(new Database(path));
}

function rowToParticipant(r: any): Participant {
  return {
    id: r.id,
    pseudonym: r.pseudonym,
    profile: r.profile,
    source: r.source,
    screener: JSON.parse(r.screener),
    linkedinVerified: !!r.linkedin_verified,
  };
}

function rowToInterview(r: any): Interview {
  return {
    id: r.id,
    participantId: r.participant_id,
    scheduledAt: r.scheduled_at ?? undefined,
    status: r.status,
  };
}

function rowToCode(r: any): CodeRow {
  return {
    id: r.id,
    interviewId: r.interview_id,
    type: r.type,
    value: r.value,
    quote: r.quote,
    turnRef: r.turn_ref,
    confidence: r.confidence ?? undefined,
    state: r.state,
  };
}

export function makeStore(db: Database) {
  return {
    createParticipant(d: {
      profile: Profile;
      source: string;
      screener: Record<string, string>;
      linkedinVerified: boolean;
    }): Participant {
      const n = (db.query("SELECT COUNT(*) c FROM participants").get() as any).c + 1;
      const pseudonym = `P${n}`;
      const r = db
        .query(
          `INSERT INTO participants (pseudonym, profile, source, screener, linkedin_verified)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(pseudonym, d.profile, d.source, JSON.stringify(d.screener), d.linkedinVerified ? 1 : 0);
      return rowToParticipant(r);
    },

    listParticipants(): Participant[] {
      return (db.query("SELECT * FROM participants ORDER BY id").all() as any[]).map(rowToParticipant);
    },

    getParticipant(id: number): Participant | null {
      const r = db.query("SELECT * FROM participants WHERE id = ?").get(id);
      return r ? rowToParticipant(r) : null;
    },

    createInterview(participantId: number, scheduledAt?: string): Interview {
      const r = db
        .query(
          "INSERT INTO interviews (participant_id, scheduled_at) VALUES (?, ?) RETURNING *",
        )
        .get(participantId, scheduledAt ?? null);
      return rowToInterview(r);
    },

    getInterview(id: number): Interview | null {
      const r = db.query("SELECT * FROM interviews WHERE id = ?").get(id);
      return r ? rowToInterview(r) : null;
    },

    listInterviews(): Interview[] {
      return (db.query("SELECT * FROM interviews ORDER BY id").all() as any[]).map(rowToInterview);
    },

    setInterviewStatus(id: number, s: InterviewStatus): void {
      db.query("UPDATE interviews SET status = ? WHERE id = ?").run(s, id);
    },

    saveTranscript(interviewId: number, filename: string, raw: string, turns: Turn[]): void {
      db.query(
        `INSERT INTO transcripts (interview_id, filename, raw, turns) VALUES (?, ?, ?, ?)
         ON CONFLICT(interview_id) DO UPDATE SET filename=excluded.filename, raw=excluded.raw, turns=excluded.turns`,
      ).run(interviewId, filename, raw, JSON.stringify(turns));
    },

    getTurns(interviewId: number): Turn[] {
      const r = db.query("SELECT turns FROM transcripts WHERE interview_id = ?").get(interviewId) as any;
      return r ? JSON.parse(r.turns) : [];
    },

    insertCodes(
      rows: Omit<CodeRow, "id" | "state">[],
      state: CodeState,
    ): void {
      const stmt = db.query(
        `INSERT INTO codes (interview_id, type, value, quote, turn_ref, confidence, state)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        stmt.run(r.interviewId, r.type, r.value, r.quote, r.turnRef, r.confidence ?? null, state);
      }
    },

    listCodes(interviewId: number): CodeRow[] {
      return (
        db.query("SELECT * FROM codes WHERE interview_id = ? ORDER BY id").all(interviewId) as any[]
      ).map(rowToCode);
    },

    setCodeState(id: number, state: CodeState, value?: string): void {
      if (value !== undefined) {
        db.query("UPDATE codes SET state = ?, value = ? WHERE id = ?").run(state, value, id);
      } else {
        db.query("UPDATE codes SET state = ? WHERE id = ?").run(state, id);
      }
    },

    /** Codes that count: confirmed, edited, or manually added. */
    effectiveCodes(interviewId: number): CodeRow[] {
      return (
        db
          .query(
            "SELECT * FROM codes WHERE interview_id = ? AND state IN ('confirmed','edited','manual') ORDER BY id",
          )
          .all(interviewId) as any[]
      ).map(rowToCode);
    },

    interviewsByProfile(profile: Profile): Interview[] {
      return (
        db
          .query(
            `SELECT i.* FROM interviews i JOIN participants p ON p.id = i.participant_id
             WHERE p.profile = ? ORDER BY i.id`,
          )
          .all(profile) as any[]
      ).map(rowToInterview);
    },

    saveNote(interviewId: number, text: string): void {
      db.query("INSERT INTO notes (interview_id, text) VALUES (?, ?)").run(interviewId, text);
    },

    listNotes(interviewId: number): { id: number; text: string; createdAt: string }[] {
      return db
        .query("SELECT id, text, created_at createdAt FROM notes WHERE interview_id = ? ORDER BY id")
        .all(interviewId) as any[];
    },

    deleteNote(id: number): void {
      db.query("DELETE FROM notes WHERE id = ?").run(id);
    },

    /** Delete one code row (UI restricts this to manual codes; suggestions are rejected instead). */
    deleteCode(id: number): void {
      db.query("DELETE FROM codes WHERE id = ?").run(id);
    },

    getCode(id: number): CodeRow | null {
      const r = db.query("SELECT * FROM codes WHERE id = ?").get(id);
      return r ? rowToCode(r) : null;
    },

    /** Remove pending suggestions so a re-run replaces instead of duplicating. */
    clearAiSuggested(interviewId: number): void {
      db.query("DELETE FROM codes WHERE interview_id = ? AND state = 'ai_suggested'").run(interviewId);
    },

    deleteInterview(id: number): void {
      const tx = db.transaction(() => {
        db.query("DELETE FROM codes WHERE interview_id = ?").run(id);
        db.query("DELETE FROM notes WHERE interview_id = ?").run(id);
        db.query("DELETE FROM transcripts WHERE interview_id = ?").run(id);
        db.query("DELETE FROM interviews WHERE id = ?").run(id);
      });
      tx();
    },

    deleteParticipant(id: number): void {
      const interviews = (
        db.query("SELECT id FROM interviews WHERE participant_id = ?").all(id) as any[]
      ).map((r) => r.id as number);
      const tx = db.transaction(() => {
        for (const iid of interviews) {
          db.query("DELETE FROM codes WHERE interview_id = ?").run(iid);
          db.query("DELETE FROM notes WHERE interview_id = ?").run(iid);
          db.query("DELETE FROM transcripts WHERE interview_id = ?").run(iid);
        }
        db.query("DELETE FROM interviews WHERE participant_id = ?").run(id);
        db.query("DELETE FROM participants WHERE id = ?").run(id);
      });
      tx();
    },

    logLlmCall(l: { purpose: string; promptHash: string; ms: number; ok: boolean; error?: string }): void {
      db.query(
        "INSERT INTO llm_calls (purpose, prompt_hash, ms, ok, error) VALUES (?, ?, ?, ?, ?)",
      ).run(l.purpose, l.promptHash, l.ms, l.ok ? 1 : 0, l.error ?? null);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
