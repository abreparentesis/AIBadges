# Interview companion app — design

Date: 2026-07-06. Status: approved (brainstormed in session, sections approved individually,
user authorized full autonomous implementation).

## Goal

An internal web app that runs the AIBadges B2B validation study end to end: guides the
interviewer live through the kit in
[docs/research/b2b-validation-interviews.md](../../research/b2b-validation-interviews.md),
ingests per-call transcripts, auto-codes them with an LLM, gates everything through human
review, runs the kit's deterministic decision rules, and produces the per-segment synthesis
pages and the final build/no-build report. Automate as much as possible; never let
automation block the interviews themselves.

## Decisions (from brainstorming)

- Purpose-built for this one study; the kit is baked in as structured data.
- Capture = transcript files only (VTT/TXT from Zoom/Meet/Teams). No audio anywhere.
- Hosted on the Hetzner (Billions) server; single user behind basic auth.
- Inference = GLM 5.2 via NVIDIA's OpenAI-compatible API; key lives in the Phase vault and
  is injected at launch via `phase run`, never on disk.
- Packaging = new top-level `interviews/` directory in this repo (approach A), own systemd
  unit, isolated from the production badge backend.
- Prior-art check returned BUILD: no existing tool combines a live guide, custom-codebook
  LLM coding, and user-defined deterministic decision rules; self-hosting + own-inference
  excluded all SaaS candidates (Dovetail, Looppanel, Notably, Marvin, Condens); QualCoder /
  OpenQDA / LLMCode are manual or research-grade. Compose small pieces:
  @plussub/srt-vtt-parser for VTT parsing, Hono + bun:sqlite per repo conventions.

## Architecture

One Bun process in `interviews/` (repo-standard layout, `bun run dev/test/build`):

- **API + UI**: Hono serving a JSON API and the built React SPA as static assets.
  Basic-auth middleware on everything.
- **Store**: `bun:sqlite` (`interviews.db`) + `uploads/` for original transcript files.
- **Engine** (pure TypeScript, no LLM, exhaustively unit-tested):
  - `kit.ts` — the question bank, stage scripts, probes, and screeners as structured data,
    transcribed once from the kit doc.
  - `codebook.ts` — code definitions and severity anchors (PAIN with H1/H3 vs H2 finance
    anchors incl. the 5-10x floor, SPEND, ALT, BUYER, PRIV-PRE, PRIV-POST, PARTIC, COMMIT).
  - `rules.ts` — the decision engine: Kill → Pivot → Proceed → Hold in fixed order with the
    kit's exact proportional thresholds, the consistent-BUYER definition, the cross-segment
    H5 kill, and the segment ranking.
- **LLM client** (`llm.ts`): thin wrapper over NVIDIA's OpenAI-compatible endpoint; model
  id and endpoint in config; key from env only.

### Data model (SQLite)

- `participants` — profile (A/B/C), platform source, screener answers (JSON), LinkedIn
  verified flag, pseudonym (P1, P2, ...).
- `interviews` — participant id, scheduled/completed timestamps, status:
  `scheduled → done → transcribed → coded → reviewed`.
- `transcripts` — interview id, original filename, raw text, parsed turns (JSON:
  speaker, start, text).
- `codes` — interview id, code type, value (e.g. severity 0-3, GREEN/AMBER/RED,
  low/mixed/high, rung 0-3), verbatim quote, turn reference, confidence, state:
  `ai_suggested → confirmed | rejected | edited`, plus `manual` for human-added codes.
- `segments` — computed verdict cache per profile (recomputed from confirmed codes).
- `notes` — interview id, timestamped free-text live notes and question-asked marks.
- `llm_calls` — log: purpose, prompt hash, latency, token counts, ok/error.

Every code row carries its quote and turn reference: every claim in the final report links
to the evidence behind it (the AIBadges principle applied to the study itself).

## Workflow

1. **Before the call** — create participant, paste screener answers; app flags missing
   screener fields and unchecked LinkedIn verification. Segment dashboard shows progress
   and verdict-if-stopped-today.
2. **During the call** — live guide screen: five-stage timeline with per-stage time budgets
   (amber on overrun so the concept block never gets squeezed), profile question bank
   ("bank, not checklist": tap to mark asked), verbatim concept-block scripts (pitch
   without privacy architecture, two-step privacy probe, two-turn participation probe,
   buyer question, commitment ladder), free-text notes pane. Entirely optional during the
   call; the transcript carries the data.
3. **After the call** — upload VTT/TXT. Pipeline: parse turns → LLM codes transcript
   against the codebook (chunked by turns with overlap; JSON schema-validated output, one
   retry with validator error, then chunk marked "needs manual coding") → review screen
   presents each suggestion with quote in context for confirm/edit/reject → confirmed codes
   feed the rules engine → segment verdict recomputes live.
4. **Reports** — per-segment synthesis page rendered from confirmed codes (verdict,
   severity histogram, named buyer, alternative + gap, spend magnitude, COMMIT
   distribution, top quotes, privacy pre/post, participation, follow-ups). LLM drafts prose
   only; all numbers come from the engine, and a post-check verifies every injected number
   appears unaltered in the draft. Final report: cross-segment comparison, H5 check,
   ranking, build/no-build call, markdown export.

## Error handling

- LLM down/slow: interview rests in `transcribed` with a retry button; manual coding via
  the review screen always works. Automation accelerates, never gates.
- Per-chunk LLM failures don't fail the batch.
- Invalid upload (unparseable file) rejected with a clear message; original file always
  kept in `uploads/`.
- All LLM calls logged to `llm_calls`.

## Privacy

Interviewee transcripts transit NVIDIA's API (covered by the recruiting platforms' research
consent). Interviewees are pseudonymous in all reports (P1/P2... + profile letter). The app
never publishes transcripts; everything sits behind basic auth. This tool is internal
research tooling and does not touch the AIBadges product privacy invariant (no product code
paths are modified).

## Deployment

`bun run build` → one deployable directory. systemd unit on the Hetzner box launches via
`phase run` (injects the NVIDIA key) on an internal port; existing reverse proxy terminates
TLS on a subdomain with basic auth. Nightly `sqlite3 .backup` + rsync of `uploads/`.

## Testing

- `rules.ts` / `codebook.ts`: exhaustive unit tests covering every boundary from the kit's
  convergent review — PRIV-RED at exactly 50%, COMMIT-2+ at exactly 40%, n=5 early stop,
  Kill-before-Pivot ordering, the participation Pivot, H2 anchors, cross-segment H5 kill.
- Threshold-sync test: engine constants must match the numbers stated in the kit doc
  (parses the doc for the literal thresholds).
- Coding pipeline: golden test with a synthetic VTT fixture and a mocked LLM.
- API: vitest integration tests for the happy path of each route.
- UI: light smoke coverage only (single-user internal tool).

## Out of scope

Audio processing, multi-user/roles, generic study authoring, scheduling integration with
the recruiting platforms, mobile layout beyond basic responsiveness.
