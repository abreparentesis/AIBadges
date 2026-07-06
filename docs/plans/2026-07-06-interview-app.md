# Interview Companion App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `interviews/`, a self-hosted app that guides the B2B validation interviews, ingests transcripts, LLM-codes them with human review, runs the kit's decision rules, and generates the synthesis and final report.

**Architecture:** One Bun process (Hono API + static React SPA), `bun:sqlite` store, pure-TS engine (`kit`/`codebook`/`rules`) mirroring [docs/research/b2b-validation-interviews.md](../research/b2b-validation-interviews.md), thin OpenAI-compatible client for GLM 5.2 on NVIDIA. Spec: [docs/specs/2026-07-06-interview-app-design.md](../specs/2026-07-06-interview-app-design.md).

**Tech Stack:** Bun, Hono, bun:sqlite, React 19, Vite, vitest, zod, @plussub/srt-vtt-parser.

## Global Constraints

- Toolchain is Bun (`bun install` / `bun run` / `bun test` via vitest) — repo convention.
- LLM: model `z-ai/glm-5.2`, endpoint `https://integrate.api.nvidia.com/v1` (OpenAI-compatible), key from env `NVIDIA_API_KEY` only (injected by `phase run`), all overridable via env (`GLM_MODEL`, `NVIDIA_BASE_URL`).
- Engine is deterministic: no LLM call may influence codes' values or verdicts; LLM output enters only as `ai_suggested` rows and prose drafts.
- Every code row must carry `quote` + `turn_ref`.
- Thresholds MUST match the kit doc exactly: pain real = ≥50% at severity ≥2; SPEND gate ≥40%; COMMIT-2+ gate 40% (Kill `<40%`, Proceed `≥40%`); Proceed needs ≥1 COMMIT-3; PRIV-POST-RED boundary 50% (Kill guard `<50%`, Pivot `≥50%`); PARTIC "mostly low" = ≥50% low; consistent BUYER = ≥50% same role AND no competing owner; rules run at n 5-8; order Kill → Pivot → Proceed → Hold.
- Basic auth on every route (env `APP_USER`/`APP_PASS`); no auth = server refuses to start in production mode.
- Commit after each task (stage files by name, never `git add -A`).

---

### Task 1: Scaffold `interviews/` with Hono server, basic auth, health route

**Files:**
- Create: `interviews/package.json`, `interviews/tsconfig.json`, `interviews/vitest.config.ts`
- Create: `interviews/src/server.ts` (createApp factory), `interviews/src/index.ts` (entry)
- Create: `interviews/src/auth.ts`
- Test: `interviews/test/server.test.ts`

**Interfaces:**
- Produces: `createApp(opts: { db: Database; dataDir: string }): Hono` — every later API task adds routes to this factory. `basicAuth(user, pass)` Hono middleware. Entry reads env: `PORT` (default 4620), `DATA_DIR` (default `./data`), `APP_USER`, `APP_PASS`, `NODE_ENV`.

- [ ] Step 1: `cd interviews && bun init -y`, then set package.json scripts: `dev` (`bun --watch src/index.ts`), `test` (`vitest run`), `build` (`vite build` — wired in Task 10). Add deps: `hono`, `zod`, `@plussub/srt-vtt-parser`; dev: `vitest`, `@types/bun`.
- [ ] Step 2: Failing test — `GET /api/health` returns 401 without auth, 200 `{ok:true}` with auth; production mode without APP_PASS throws on startup.
- [ ] Step 3: Implement `auth.ts` (constant-time compare via `crypto.timingSafeEqual`) and `server.ts` with the health route.
- [ ] Step 4: `bun test` → PASS.
- [ ] Step 5: Commit `feat(interviews): scaffold app with auth and health route`.

### Task 2: Engine types + `codebook.ts`

**Files:**
- Create: `interviews/src/engine/types.ts`, `interviews/src/engine/codebook.ts`
- Test: `interviews/test/codebook.test.ts`

**Interfaces (produces — later tasks depend on these exact names):**

```ts
// types.ts
export type Profile = 'A' | 'B' | 'C';
export type CodeType = 'PAIN' | 'SPEND' | 'ALT' | 'BUYER' | 'PRIV_PRE' | 'PRIV_POST' | 'PARTIC' | 'COMMIT';
export type Severity = 0 | 1 | 2 | 3;
export type PrivColor = 'GREEN' | 'AMBER' | 'RED';
export type ParticLevel = 'low' | 'mixed' | 'high';
export type CommitRung = 0 | 1 | 2 | 3;
export interface CodeValue { type: CodeType; value: string } // value validated per type by codebook
export interface CodedInterview {
  interviewId: number;
  pain?: Severity;           // on the profile's owning hypothesis
  spend: boolean;
  buyerRole?: string;        // normalized lowercase role
  buyerCompeting: boolean;
  privPost?: PrivColor;
  partic?: ParticLevel;
  commit: CommitRung;
}
```

```ts
// codebook.ts
export interface CodeDef { type: CodeType; values: string[]; description: string; anchors?: Record<Profile, string> }
export const CODEBOOK: CodeDef[];                       // all 8 types with per-profile PAIN anchors (H2 magnitude/opacity + 5-10x floor)
export function isValidValue(type: CodeType, value: string): boolean;
export function toCodedInterview(interviewId: number, codes: CodeValue[]): CodedInterview; // last-confirmed-wins per type
```

- [ ] Step 1: Failing tests: `isValidValue('PAIN','2')` true, `('PAIN','4')` false, `('PRIV_POST','RED')` true, `('PARTIC','maybe')` false, `('COMMIT','3')` true; `toCodedInterview` maps a mixed code list to the struct and defaults `commit:0`, `spend:false`, `buyerCompeting:false`.
- [ ] Step 2: Implement; PAIN anchors text copied from the kit doc (H1/H3 generic, H2 finance-specific with the 5-10x floor).
- [ ] Step 3: `bun test` PASS; commit `feat(interviews): engine types and codebook`.

### Task 3: `rules.ts` decision engine + exhaustive boundary tests + threshold-sync test

**Files:**
- Create: `interviews/src/engine/rules.ts`
- Test: `interviews/test/rules.test.ts`, `interviews/test/kit-sync.test.ts`

**Interfaces (produces):**

```ts
export type Verdict = 'KILL' | 'PIVOT_PRIVACY' | 'PIVOT_PARTICIPATION' | 'PROCEED' | 'HOLD' | 'INSUFFICIENT';
export interface SegmentMetrics {
  n: number; painRealPct: number; painMostlyLE1: boolean; spendPct: number;
  commit2PlusPct: number; hasCommit3: boolean; privRedPct: number; particLowPct: number;
  buyerConsistent: boolean; buyerRole?: string;
}
export interface SegmentVerdict { verdict: Verdict; reasons: string[]; metrics: SegmentMetrics }
export function computeMetrics(interviews: CodedInterview[]): SegmentMetrics;
export function evaluateSegment(interviews: CodedInterview[]): SegmentVerdict;   // INSUFFICIENT below n=5
export function crossSegmentKill(all: SegmentVerdict[]): boolean;                 // true if NO segment buyerConsistent
export function rankSegments(v: Map<Profile, SegmentVerdict>, avgPain: Map<Profile, number>): Profile[]; // PROCEED only, by avgPain*spendPct*commit2PlusPct desc
```

Rule order (verbatim from kit): Kill first — `painMostlyLE1 OR (commit2PlusPct < 40 && !hasCommit3 && privRedPct < 50)`; then Pivot — `painRealPct >= 50 && privRedPct >= 50` → PIVOT_PRIVACY, else `painRealPct >= 50 && particLowPct >= 50` → PIVOT_PARTICIPATION; then Proceed — `painRealPct >= 50 && spendPct >= 40 && buyerConsistent && commit2PlusPct >= 40 && hasCommit3 && particLowPct < 50`; else Hold. `painMostlyLE1` = strictly more than 50% of interviews at severity ≤1. Interviews with `pain === undefined` count in `n` but as not-severity≥2 (conservative). `buyerConsistent` = ≥50% share the same normalized `buyerRole` AND no interview has `buyerCompeting`.

- [ ] Step 1: Failing tests, one per boundary from the kit's convergent review (build a `mk(overrides)` helper returning a default CodedInterview):
  - n=4 → INSUFFICIENT; n=5 all pain≤1 → KILL (early-stop case).
  - Pain exactly 50% at ≥2 (3 of 6) → not "mostly ≤1", Kill clause 1 must NOT fire.
  - Strong pain + privRed 60% + commit2Plus 20% no C3 → PIVOT_PRIVACY (privacy guard blocks Kill).
  - Strong pain + privRed 40% + commit2Plus 20% no C3 → KILL (guard doesn't apply).
  - Strong pain + privRed exactly 50% → PIVOT_PRIVACY; at 49.9% (not constructible with ints — use 3/8 vs 4/8) → falls through.
  - Would-Proceed but particLow 50% → PIVOT_PARTICIPATION; particLow 50% + thin spend + real pain + decent commit → still PIVOT_PARTICIPATION ("whatever the other bars say").
  - commit2Plus exactly 40% (2/5) + hasCommit3 + all other Proceed bars → PROCEED.
  - All Proceed bars except no COMMIT-3 → HOLD.
  - All Proceed bars except spend 20% → HOLD (the kit's typical Hold).
  - buyer split 2/2/2 roles or any buyerCompeting → not consistent → HOLD not PROCEED; crossSegmentKill true when no segment consistent, false when one is.
- [ ] Step 2: Implement `rules.ts` (pure functions, no I/O).
- [ ] Step 3: `kit-sync.test.ts`: read `../docs/research/b2b-validation-interviews.md` and assert it still contains the literal threshold strings the engine hard-codes: `"≥50% at severity ≥2"`, `"≥40% show"`, `"≥40% reach COMMIT-2+"`, `"under 40% with no"`, `"PRIV-POST-RED covers ≥50%"`, `"≥50% of its"` (buyer), `"5 to 8 per segment"`. If the doc changes, this test fails and forces an engine review.
- [ ] Step 4: `bun test` PASS; commit `feat(interviews): decision rules engine with kit boundary tests`.

### Task 4: `kit.ts` — the interview kit as structured data

**Files:**
- Create: `interviews/src/engine/kit.ts`
- Test: `interviews/test/kit.test.ts`

**Interfaces (produces):**

```ts
export interface Stage { id: string; title: string; minMinutes: number; maxMinutes: number }
export const STAGES: Stage[]; // context 5-5, pain 15-20, alternatives 10-10, concept 10-15, close 2-2
export interface Question { id: string; text: string; listenFor?: string }
export const OPENER: Question[];                      // 3 shared opener questions
export const QUESTION_BANK: Record<Profile, Question[]>; // 5-6 per profile, verbatim from the doc
export const CONCEPT_BLOCK: { pitch: string; steps: { id: string; label: string; script: string; codes: CodeType[] }[] };
export const SCREENERS: Record<Profile, string[]>;
export const PROFILE_LABELS: Record<Profile, string>; // A: Talent/L&D, B: Finance, C: Technical
```

- [ ] Step 1: Failing test: STAGES sum of min ≥ 42; concept block has steps in the fixed order [first-reaction, month-one-decision, priv-pre, priv-post, partic-1, partic-2, buyer, commit-ladder]; every profile has ≥5 bank questions; pitch text does NOT contain the words "privacy" or "raw conversations" (the un-led pitch invariant).
- [ ] Step 2: Transcribe content verbatim from the kit doc sections 3-4 (including "bank, not checklist" note and per-question listen-fors).
- [ ] Step 3: `bun test` PASS; commit `feat(interviews): kit content as structured data`.

### Task 5: SQLite store

**Files:**
- Create: `interviews/src/store/schema.sql`, `interviews/src/store/db.ts`
- Test: `interviews/test/store.test.ts`

**Interfaces (produces):**

```ts
export function openDb(path: string): Database;        // runs schema.sql idempotently (CREATE TABLE IF NOT EXISTS)
export interface Participant { id: number; pseudonym: string; profile: Profile; source: string; screener: Record<string,string>; linkedinVerified: boolean }
export interface Interview { id: number; participantId: number; scheduledAt?: string; status: 'scheduled'|'done'|'transcribed'|'coded'|'reviewed' }
export interface CodeRow { id: number; interviewId: number; type: CodeType; value: string; quote: string; turnRef: number; confidence?: number; state: 'ai_suggested'|'confirmed'|'rejected'|'edited'|'manual' }
export const store: {
  createParticipant(d: Omit<Participant,'id'|'pseudonym'>): Participant;   // pseudonym auto: P<n>
  listParticipants(): Participant[];
  createInterview(participantId: number, scheduledAt?: string): Interview;
  getInterview(id: number): Interview | null;
  setInterviewStatus(id: number, s: Interview['status']): void;
  saveTranscript(interviewId: number, filename: string, raw: string, turns: Turn[]): void;
  getTurns(interviewId: number): Turn[];
  insertCodes(rows: Omit<CodeRow,'id'|'state'>[], state: CodeRow['state']): void;
  listCodes(interviewId: number): CodeRow[];
  setCodeState(id: number, state: CodeRow['state'], value?: string): void;
  effectiveCodes(interviewId: number): CodeRow[];       // confirmed | edited | manual only
  interviewsByProfile(profile: Profile): Interview[];
  saveNote(interviewId: number, text: string): void;
  logLlmCall(l: { purpose: string; promptHash: string; ms: number; ok: boolean; error?: string }): void;
};
```

- [ ] Step 1: Failing tests against an in-memory db (`openDb(':memory:')`): participant gets P1/P2 pseudonyms; status transitions persist; insertCodes+setCodeState+effectiveCodes filters correctly; transcript round-trips turns JSON.
- [ ] Step 2: Write schema.sql (tables: participants, interviews, transcripts, codes, notes, llm_calls; FKs ON; indices on interviewId) and db.ts with prepared statements.
- [ ] Step 3: `bun test` PASS; commit `feat(interviews): sqlite store`.

### Task 6: Transcript ingest (VTT/TXT → turns)

**Files:**
- Create: `interviews/src/ingest/parse.ts`
- Test: `interviews/test/parse.test.ts`, fixture `interviews/test/fixtures/sample.vtt`, `interviews/test/fixtures/sample.txt`

**Interfaces (produces):**

```ts
export interface Turn { i: number; speaker: string; start?: string; text: string }
export function parseTranscript(filename: string, content: string): Turn[]; // throws ParseError with human message
```

Rules: `.vtt` via `@plussub/srt-vtt-parser`, speaker from `<v Name>` tags or `Name:` prefix; `.txt` split on `Name: text` lines (multiline continuation appended); consecutive same-speaker entries merged into one turn; empty result → ParseError.

- [ ] Step 1: Fixtures: a 10-cue VTT with two speakers (`<v Sebastian>` / `<v P1>`) and a Zoom-style TXT. Failing tests: turn count, merge behavior, speaker extraction, garbage input throws ParseError.
- [ ] Step 2: Implement; `bun test` PASS; commit `feat(interviews): transcript parsing`.

### Task 7: LLM client + coding pipeline

**Files:**
- Create: `interviews/src/llm/client.ts`, `interviews/src/llm/coder.ts`, `interviews/src/llm/prompts.ts`
- Test: `interviews/test/coder.test.ts` (mock client), `interviews/test/client.test.ts` (fetch mocked)

**Interfaces (produces):**

```ts
// client.ts — the ONLY module that talks to the network
export interface LlmClient { complete(opts: { system: string; user: string; json?: boolean }): Promise<string> }
export function makeClient(env = process.env): LlmClient; // model z-ai/glm-5.2, base https://integrate.api.nvidia.com/v1, temperature 0.2, logs via store.logLlmCall
// coder.ts
export interface CodeSuggestion { type: CodeType; value: string; quote: string; turnRef: number; confidence: number }
export function chunkTurns(turns: Turn[], maxChars?: number): Turn[][];   // default 8000, overlap 2 turns
export async function codeTranscript(turns: Turn[], profile: Profile, client: LlmClient):
  Promise<{ suggestions: CodeSuggestion[]; failedChunks: number[] }>;
```

Pipeline per chunk: prompt = codebook definitions (per profile PAIN anchors) + few-shot examples (2 in prompts.ts) + chunk turns with indices → expect JSON array; validate with zod (`isValidValue`, turnRef within chunk, quote must be a substring of the referenced turn's text — hallucinated quotes rejected); on invalid → one retry appending the validator errors; still invalid → chunk index pushed to `failedChunks` (never throws). Suggestions deduped on (type,value,quote).

- [ ] Step 1: Failing coder tests with a scripted fake client: valid JSON path; invalid-then-valid retry path; always-invalid → failedChunks; quote-not-in-turn rejected; chunking respects maxChars and overlap.
- [ ] Step 2: Implement client (OpenAI-compatible `/chat/completions`, 120s timeout, response_format json_object when `json`) + coder + prompts.
- [ ] Step 3: `bun test` PASS; commit `feat(interviews): GLM coding pipeline with schema validation`.

### Task 8: API routes

**Files:**
- Create: `interviews/src/api/routes.ts` (mounted by `createApp`)
- Modify: `interviews/src/server.ts` (mount)
- Test: `interviews/test/api.test.ts`

**Routes (produces — UI consumes exactly these):**
- `GET/POST /api/participants`; `POST /api/participants/:id/interviews`
- `GET /api/interviews/:id` (joined view: participant, status, turns?, codes, notes)
- `POST /api/interviews/:id/transcript` (multipart file → save original to `DATA_DIR/uploads/<id>-<filename>`, parse, status→transcribed, then fire-and-forget coding job unless `?manual=1`)
- `POST /api/interviews/:id/code` (re/run coding job) — job writes ai_suggested rows, status→coded
- `POST /api/codes/:id` body `{state, value?}`; `POST /api/interviews/:id/codes` (manual add)
- `POST /api/interviews/:id/review-done` (status→reviewed, recompute segment)
- `POST /api/interviews/:id/notes`
- `GET /api/segments` → per profile: `SegmentVerdict` from `evaluateSegment(effectiveCodes → toCodedInterview)` over reviewed interviews + interviews count by status + crossSegmentKill + ranking
- `GET /api/kit` → STAGES/OPENER/QUESTION_BANK/CONCEPT_BLOCK/SCREENERS
- `GET /api/reports/segment/:profile`, `GET /api/reports/final` (Task 9)

In-process job runner: `runCodingJob(interviewId)` with a `Map<number,'running'|'error'|'done'>` status exposed at `GET /api/interviews/:id/coding-status`; LLM errors land as status `error` + retry via `POST .../code`.

- [ ] Step 1: Failing integration tests (Hono `app.request`, in-memory db, fake LlmClient injected through `createApp` opts): create participant → interview → upload fixture VTT → poll coding-status → codes listed as ai_suggested → confirm two, reject one → review-done → `GET /api/segments` returns INSUFFICIENT (n=1) with metrics.
- [ ] Step 2: Implement; `bun test` PASS; commit `feat(interviews): API routes and coding job`.

### Task 9: Reports (synthesis + final)

**Files:**
- Create: `interviews/src/reports/synthesis.ts`
- Test: `interviews/test/reports.test.ts`

**Interfaces (produces):**

```ts
export interface SynthesisFacts { profile: Profile; verdict: SegmentVerdict; severityHistogram: number[]; buyerRole?: string; alternatives: {quote: string; interview: string}[]; spendQuotes: {quote: string; interview: string}[]; commitDistribution: number[]; privPre: Record<PrivColor,number>; privPost: Record<PrivColor,number>; partic: Record<ParticLevel,number>; topQuotes: {quote: string; interview: string}[] }
export function buildFacts(profile: Profile, db: Database): SynthesisFacts;                  // engine numbers only
export async function draftSynthesis(facts: SynthesisFacts, client: LlmClient): Promise<string>; // markdown; prose only
export function verifyNumbers(facts: SynthesisFacts, draft: string): string[];               // returns list of numbers missing/altered
export async function finalReport(db: Database, client: LlmClient): Promise<string>;         // cross-segment md, incl. H5 + ranking + build/no-build
```

`draftSynthesis` prompt injects facts as a JSON block the model must reproduce faithfully; `verifyNumbers` extracts every integer/pct from facts and asserts presence in the draft; mismatches appended to the report as a visible warning banner, never silently accepted. If the LLM is unavailable, reports render from facts alone with a "prose unavailable" note.

- [ ] Step 1: Failing tests: buildFacts histograms from a seeded db; verifyNumbers catches an altered percentage; finalReport contains each profile's verdict and the cross-segment kill line when applicable; LLM-down path still renders.
- [ ] Step 2: Implement + wire the two report routes in `routes.ts`; `bun test` PASS; commit `feat(interviews): synthesis and final report`.

### Task 10: UI shell + dashboard + participants (Vite + React)

**Files:**
- Create: `interviews/ui/index.html`, `interviews/ui/src/main.tsx`, `interviews/ui/src/App.tsx`, `interviews/ui/src/api.ts`, `interviews/ui/src/pages/Dashboard.tsx`, `interviews/ui/src/pages/Participants.tsx`, `interviews/vite.config.ts`
- Modify: `interviews/package.json` (`build`: `vite build && ...`), `interviews/src/server.ts` (serve `ui/dist` statics with SPA fallback)

Views: **Dashboard** — three segment cards (interviews by status, live verdict badge with reasons, verdict-if-stopped-today), cross-segment banner when H5 kill fires. **Participants** — table + create form (profile, source platform, screener textarea pairs, LinkedIn-verified checkbox; missing screener fields flagged inline), per-participant "new interview" button. Light theme, clean spacing (global design default). `api.ts` is a typed fetch wrapper (credentials included; basic auth handled by the browser prompt).

- [ ] Step 1: Scaffold Vite React app in `ui/` (no router lib — a tiny hash router in App.tsx with routes `#/`, `#/participants`, `#/interview/:id`, `#/review/:id`, `#/reports`).
- [ ] Step 2: Implement api.ts + Dashboard + Participants against the Task 8 routes.
- [ ] Step 3: `bun run build` succeeds; server serves the SPA; add one vitest smoke test asserting built index.html is served at `/`. Commit `feat(interviews): UI shell, dashboard, participants`.

### Task 11: Live guide screen

**Files:**
- Create: `interviews/ui/src/pages/LiveGuide.tsx`, `interviews/ui/src/components/StageTimer.tsx`, `interviews/ui/src/components/QuestionBank.tsx`, `interviews/ui/src/components/ConceptScripts.tsx`

Behavior: start button begins the session clock; StageTimer shows the five stages with elapsed/budget, current stage highlighted, amber background past `maxMinutes` (pure CSS class swap, tick via 1s interval); QuestionBank lists opener + profile questions with tap-to-mark-asked (persisted via `POST /notes` as `asked:<qid>`), listen-fors collapsed under each; ConceptScripts renders the pitch and the eight fixed steps verbatim with the code chips they feed; notes textarea autosaves (debounced 2s) to `/notes`. Everything readable at a glance: 18px+ base font, two-column layout ≥1100px.

- [ ] Step 1: Implement components (data from `GET /api/kit`).
- [ ] Step 2: Manual check via `bun run dev` + build passes. Commit `feat(interviews): live guide screen`.

### Task 12: Review screen + reports pages

**Files:**
- Create: `interviews/ui/src/pages/Review.tsx`, `interviews/ui/src/pages/Reports.tsx`, `interviews/ui/src/components/CodeCard.tsx`

Review: transcript pane (turns, scrollable) + suggestions pane; each CodeCard shows type badge, value selector (valid values from codebook via `/api/kit`), quote (click → scrolls transcript to turnRef, highlighted), confidence, confirm/edit/reject buttons; "add manual code" flow (pick turn → type → value → quote prefilled from turn); footer "mark reviewed" calls `review-done` and shows the recomputed segment verdict delta. Reports: segment report tabs + final report, rendered markdown, download buttons (`.md`).

- [ ] Step 1: Implement; upload flow on the interview page (`#/interview/:id`: dropzone → POST transcript → coding-status poller → link to review).
- [ ] Step 2: Build passes; end-to-end happy path exercised against dev server with the fixture VTT and fake LLM env (`GLM_FAKE=1` client stub honored by `makeClient` for local dev). Commit `feat(interviews): review and reports UI`.

### Task 13: Deploy config + runbook + README

**Files:**
- Create: `interviews/deploy/interview-app.service`, `interviews/deploy/backup.sh`, `interviews/README.md`
- Modify: `README.md` (repo table: one line for `interviews/`), `docs/HANDOFF.md` (pointer)

systemd unit: `ExecStart=/usr/bin/env phase run --app-id 075a8ab8-78d4-4f75-9fdd-a94ba7d1712e --env Development --path /global -- bun run start` with `WorkingDirectory=/opt/aibadges/interviews`, `Environment=PORT=4620 NODE_ENV=production DATA_DIR=/opt/aibadges/interviews-data`, hardening (`NoNewPrivileges`, `ProtectSystem=strict` + RW data dir). backup.sh: `sqlite3 .backup` + rsync uploads. README: install, env vars, reverse-proxy snippet (Caddy `interviews.<domain> { basic_auth ... reverse_proxy :4620 }`), runbook, restore.

- [ ] Step 1: Write files; `bun test` full suite green; commit `feat(interviews): deploy config and runbook`.

---

## Self-review notes

- Spec coverage: architecture→T1/5, engine→T2-4, ingest→T6, LLM→T7, review flow→T8/12, reports→T9/12, live guide→T11, deploy/backup→T13, testing woven through. Privacy (pseudonyms) in store T5 (pseudonym) and reports T9 (facts use pseudonyms only).
- Type consistency: `CodedInterview`/`SegmentVerdict`/`Turn`/`CodeRow`/`LlmClient` defined once (T2/T3/T5/T6/T7) and consumed by name in T8/T9.
- No placeholder steps; UI tasks specify exact behavior and routes rather than full JSX listings by design (single implementer, same session).
