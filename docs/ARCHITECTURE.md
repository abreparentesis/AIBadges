# AIBadges architecture

This document explains how the system is built and why. It assumes you have read the root [README](../README.md).

## 1. The two surfaces

AIBadges is a browser extension plus a thin backend.

- **The extension (`client/`)** does everything that matters: it captures chats, runs (or hands off) inference, builds the profile, stores it locally with its evidence, and renders the report. The product would still function for a single user with the backend turned off (sharing would be the only thing missing).
- **The backend (`server/`)** is deliberately thin. It stores the distilled badge per user, mints share tokens, and server-renders a public report page. It never receives raw chats.

The trust boundary runs between them: everything sensitive stays in the extension; only the badge crosses to the backend.

## 2. Data model

Defined as Zod schemas in `client/src/engine/types.ts` (the client is the source of truth; `server/src/types.ts` mirrors the subset the backend validates).

- **EvidenceUnit.** `{ id, timestamp, sourceRef:{provider, conversationId}, type, quote, summary }`. A short, verbatim behavioral observation drawn from the user's own words. `quote` is the only place raw chat text lives in a profile. `type` is one of `decision | reasoning_move | episode | preference`.
- **Capability.** The product's core: four AI-fluency dimensions (`delegation`, `description`, `discernment`, `diligence`), each a band `emerging | developing | proficient | advanced` with a plain-language `note`, a personal `nextStep`, and the evidence ids that earn it; a 1-8 `yeggeStage` derived from the bands; and `fluencyScore`, a 1-100 number computed as `round(avgBand/4 x 80)` and therefore capped at 80, because chat evidence cannot show the agent-orchestration tier. Levels (`Beginner/Intermediate/Advanced/Expert` in `levels.ts`) map from the stage.
- **Coverage.** `{ provisional, conversationCount, evidenceConversations }`. A profile is provisional when the history is thin (fewer than 10 conversations, or evidence drawn from fewer than 5); the UI and the public share page both surface it.
- **Claim / CognitiveType / Trajectory.** The personality lens. Dormant: the product ships fluency-only (`FLUENCY_ONLY` in `client/src/config.ts`), which skips computing these and hides their UI. The schemas and code remain, gated rather than deleted.
- **Profile.** The above plus `version`, `computedAt`, `modelProvenance`, and `sourceWindow`. The `evidence` array is optional on the schema **by design** so an evidence-free profile (what the backend receives) still validates.
- **Signal.** A distilled, shareable card derived from the profile. In fluency-only mode exactly one exists: `statBadge` (score, level, stage, the four bands, source provider). Each signal carries a `disclosure` of `private | public`. Publish state is user state: re-runs carry `disclosure`/`shareToken` over and re-push public content so the share page stays fresh at the same URL (`client/src/sync/signal-state.ts`).
- **Provider.** Everything is measured per provider (`claude` and `chatgpt`): local storage slots, run-status keys, backend user keys, and therefore share URLs are all namespaced (`client/src/store/provider.ts`). One person legitimately has two different fluency profiles.

## 3. The inference engine

The pipeline lives in `client/src/engine/` and turns raw conversations into a `Profile`.

```
conversations (only new/changed ones — see incremental extraction below)
  → extractEvidence   (evidence.ts)      two passes per chunk: a general sweep, then a reaction-
                                         focused sweep (corrections, pushback, verification — the
                                         evidence a single pass under-samples); quotes verified
                                         against source text; passes unioned and deduped
  → merge pool        (evidence-pool.ts) union with the persistent per-provider evidence pool,
                                         dedupe by conversation + quote containment, re-id
  → computeCapability (capability.ts)    score the four fluencies from the merged evidence,
                                         then an ADVERSARIAL AUDIT turn re-judges every cited
                                         quote and re-bands from what survives
  → assembleProfile   (assemble.ts)      anchor, grade, evidence-cap the bands, derive the
                                         stage and fluencyScore, prune  →  Profile
  → distill           (distill.ts)       Profile → the shareable statBadge signal
```

Two pieces of persistent state make scores stable and re-runs cheap (both local-only, never synced):

- **Evidence pool** (`client/src/engine/evidence-pool.ts`, `aibadges:evidencePool:<provider>`): verified quotes accumulate across runs (capped at 200, oldest evicted), so a band cannot drop because a re-run failed to re-find one borderline quote. Synthesis always judges fresh units plus the pool.
- **Scan set** (`client/src/store/scanset.ts`, `aibadges:scanned:<provider>`): conversation id to list-API `updatedAt` fingerprint. A re-run fetches and extracts only new or changed conversations; an unchanged history skips straight to synthesis. The set is versioned per provider: bumping `SCANNER_VERSION` (for an extractor upgrade, e.g. Haiku to Sonnet) discards it and forces one full rescan, while the pool is kept and re-extracted quotes dedupe in.

The credibility rules all live in **`assembleProfile`** (`client/src/engine/assemble.ts`), which is the single chokepoint both providers go through:

- **Anchoring.** A claim, axis, or shift survives only if it cites evidence that actually exists in the profile's evidence set. Unbacked items are dropped; an unbacked type axis is neutralized to lean 50; a type with no backed axis is dropped entirely.
- **Confidence grading.** Confidence is recomputed from evidence weight, not taken from the model: `high` requires at least 3 evidence units across at least 2 distinct conversations; `medium` requires at least 2 units; otherwise `low`.
- **Evidence pruning.** Only the evidence actually referenced by surviving claims is retained.

Quote verification (`client/src/engine/evidence.ts`, `quoteAppearsIn` / `contiguousWordRatio`) checks that an evidence quote is really present in the source text, so a model that paraphrases or fabricates a quote has that unit dropped before anchoring.

The effect: the profile cannot assert more than its quoted evidence supports, regardless of which model produced it. This is the foundation of the credibility story (see "Roadmap" in HANDOFF for where it goes next, including zkTLS).

## 4. The privacy boundary

`client/src/sync/backend.ts` is the only place that talks to the backend. `chatPrivateProfile()` clones the profile and deletes its `evidence` array before `pushProfile` serializes the body, so verbatim quotes never leave the device. The badge that does cross carries the fluency score, level, stage, bands, and opaque evidence ids (e.g. `"e1"`) that resolve to quotes only in local storage. `distill()` builds the signal only from banded fields, never from quotes, so `setSignals` is safe too. The evidence pool and the run checkpoints also contain verbatim quotes; they live exclusively in `chrome.storage.local` and no sync code path reads them.

Tests assert this end to end: a planted secret quote is shown to be absent from the pushed request body while remaining in the on-device profile (`client/tests/sync/backend.test.ts`, `client/tests/run/import-chatgpt.test.ts`).

The server schema keeps `evidence` optional, and the deployed server has no evidence column, so an evidence-free profile is the normal case.

## 5. Per-provider paths

The capture adapters share a `CaptureAdapter` interface (`client/src/capture/types.ts`) but the inference handoff differs by provider because of what each platform allows.

### Claude (in-session, fully automatic)

Inference runs inside the user's authenticated claude.ai tab. The content script (`client/entrypoints/claude.content.ts`) fetches Claude's internal endpoints same-origin (organizations, `chat_conversations`, and a scratch-conversation `/completion` SSE that is created and deleted per call) via `client/src/inference/in-session.ts`. This works because the request originates from claude.ai with the user's session, so there is no paid API and no bot gate. The capture adapter retries transient 503/429/network errors with backoff (one flaky response out of ~90 sequential reads must not kill a run). The caller is rate-limit aware (handles `RateLimitError` with backoff and an honest "usage cap reached" message). Model choice comes from the models the account actually uses (`pickModels`): extraction prefers Sonnet (never Haiku when anything better exists; Haiku measurably under-mined reaction evidence), synthesis and audit use the best available. The popup and `background.ts` form a small state machine: blue idle, amber while profiling, green when a fresh profile is ready, back to blue once opened, with an alarms watchdog that fails the run if the tab closes. All run-lifecycle storage keys are namespaced per provider so the two flows never bleed state.

`selectAcrossTimeline` (`client/src/capture/select.ts`) samples 90 conversations evenly across the whole history (oldest to newest), matching the ChatGPT window for cross-provider comparability.

### ChatGPT (the user's own ChatGPT does the inference)

ChatGPT cannot run in-session inference the way Claude does: the direct completion endpoint is gated by OpenAI's sentinel proof-of-work and Cloudflare Turnstile, and free users have no API access. **We do not bypass bot detection.** Instead the extension drives the user's own logged-in ChatGPT session through its normal UI, in background tabs the user never sees.

1. **Capture** (`client/src/capture/chatgpt.ts`): read-only calls to ChatGPT's internal API (`/api/auth/session`, `/backend-api/conversations`, `/backend-api/conversation/{id}`) using the page session. `linearizeMapping` walks the `current_node` parent chain to recover the active message branch. `buildChatGptExport` (`chatgpt-export.ts`) truncates (user turns kept, assistant turns reduced to short heads) and assigns synthetic conversation ids (`c1..cN`); real UUIDs stay on-device in an `idMap`.
2. **Invisible autorun (primary path, `client/src/capture/chatgpt-autorun.ts`):** map-reduce over the history. Extraction runs in batches of 30 conversations, each batch a single model turn in its own throwaway conversation inside a parallel background worker tab (the service worker owns tab lifecycle; up to 2 concurrent). Synthesis over the pooled evidence and the adversarial audit then run sequentially in one conversation in the orchestrator tab. Every completed batch is checkpointed to storage (order-independent), so an interrupted run resumes instead of restarting; step-aware reply deadlines and heartbeats survive hidden-tab timer throttling; every throwaway conversation is deleted so nothing lands in the user's ChatGPT history. The composer bridge (`chatgpt-bridge.ts`, user presses send) and the manual copy-paste flow remain as fallbacks.
3. **Import** (`client/src/engine/chatgpt-import.ts`, orchestrated by `client/src/run/import-chatgpt.ts`): the reply is parsed leniently, joined back to the captured export to recover timestamps and real ids, then run through the same `assembleProfile`. The badge is synced under the ChatGPT-specific user key; the raw capture is cleared.

## 6. The backend

`server/src/app.ts` (Hono), `server/src/db.ts` (`bun:sqlite`), entrypoint `server/src/index.ts`.

Auth is a per-provider opaque bearer key generated on the device (`client/src/store/userkey.ts`), with `X-AIBadges-Invite` gating first-time registration when `INVITE_TOKEN` is configured (empty means permissionless). CORS is open on `/v1/*` because the content script calls from the provider origin (bearer only, no cookies).

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | liveness (used by the compose healthcheck) |
| POST | `/v1/profile` | store a new profile version (self-registers when allowed) |
| GET | `/v1/profile` | latest profile + the user's signals |
| DELETE | `/v1/profile` | erase everything held for this key: versions, signals, share links, the user row (self-serve, idempotent) |
| POST | `/v1/signals` | upsert signals; mint/keep/clear share tokens by disclosure |
| GET | `/v1/share/:token` | JSON read of one shared signal |
| GET | `/s/:token` | public fluency certificate (PUBLIC content only), server-rendered, with OpenGraph tags |
| GET | `/og/:token.png` | the share page's social-preview image, rendered server-side |

Production hardening lives in `server/src/hardening.ts`: per-key sliding-window rate limits (writes 30 per 5 minutes; public `/s/` and `/og/` 120 per minute per client, because the OG image renders a PNG per request), a 256KB body cap on `/v1/*`, nosniff everywhere, and CSP + no-referrer + frame-denial on the share pages. `server/scripts/backup.sh` snapshots the live SQLite database with `VACUUM INTO` (cron-able; the reference host runs it daily).

The `/s/:token` page is a fluency certificate: score, level, the four dimension bands with explanations, the measured window, and a provisional banner when coverage is thin. It shows only what the owner marked public.

## 7. Build and test

- Client: WXT builds each entrypoint (`popup`, `results`, `chatgpt` pages; `claude` and `chatgpt-capture` content scripts; `background`) into `client/.output/chrome-mv3`. `bun run test` runs the Vitest suite. The pure logic (engine, import, prompt, sync, capture transforms) is unit-tested; the live-DOM bridge interaction is not (it has no DOM in the test env, so its decision logic was extracted into the testable `watcherDecision`).
- Server: `bun test` runs the Hono app against an in-memory database.

## 8. Source of truth

This document and [HANDOFF](HANDOFF.md) are the current source of truth for how the system works and where it stands. The full design history lives in the git history.
