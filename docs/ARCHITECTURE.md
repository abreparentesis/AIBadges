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
- **Claim.** `{ claim, evidenceIds[], confidence }`. A statement about how the person thinks, each citing the evidence ids that justify it.
- **CognitiveType.** A four-letter behavioral type from public-domain Jungian dichotomies (E/I, S/N, T/F, J/P), with a per-axis `lean` (50-100) and the evidence behind each axis. Optional; omitted when the evidence does not support it.
- **Trajectory.** `{ window, shifts[] }`, where each shift is a dimension changing over time (`rising | falling | steady`, a velocity, and its evidence).
- **Profile.** The above plus `version`, `computedAt`, `modelProvenance`, and `sourceWindow`. The `evidence` array is optional on the schema **by design** so an evidence-free profile (what the backend receives) still validates.
- **Signal.** A distilled, shareable card derived from the profile: `identityCard` (how you think), `typeCard` (cognitive type), `trajectorySnippet`. Each carries a `disclosure` of `private | public`.

## 3. The inference engine

The pipeline lives in `client/src/engine/` and turns raw conversations into a `Profile`.

```
conversations
  → extractEvidence   (evidence.ts)   map-reduce: chunk conversations, pull evidence units, verify quotes
  → synthesize        (synthesize.ts) one combined call → { thinking, trajectory, type }
  → assembleProfile   (assemble.ts)   anchor, grade, prune  →  Profile
  → distill           (distill.ts)    Profile → shareable Signals
```

The credibility rules all live in **`assembleProfile`** (`client/src/engine/assemble.ts`), which is the single chokepoint both providers go through:

- **Anchoring.** A claim, axis, or shift survives only if it cites evidence that actually exists in the profile's evidence set. Unbacked items are dropped; an unbacked type axis is neutralized to lean 50; a type with no backed axis is dropped entirely.
- **Confidence grading.** Confidence is recomputed from evidence weight, not taken from the model: `high` requires at least 3 evidence units across at least 2 distinct conversations; `medium` requires at least 2 units; otherwise `low`.
- **Evidence pruning.** Only the evidence actually referenced by surviving claims is retained.

Quote verification (`client/src/engine/evidence.ts`, `quoteAppearsIn` / `contiguousWordRatio`) checks that an evidence quote is really present in the source text, so a model that paraphrases or fabricates a quote has that unit dropped before anchoring.

The effect: the profile cannot assert more than its quoted evidence supports, regardless of which model produced it. This is the foundation of the credibility story (see "Roadmap" in HANDOFF for where it goes next, including zkTLS).

## 4. The privacy boundary

`client/src/sync/backend.ts` is the only place that talks to the backend. `chatPrivateProfile()` clones the profile and deletes its `evidence` array before `pushProfile` serializes the body, so verbatim quotes never leave the device. The badge that does cross carries claims, the type, the trajectory, and opaque evidence ids (e.g. `"e1"`) that resolve to quotes only in local storage. `distill()` builds signals only from claim/type/trajectory fields, never from quotes, so `setSignals` is safe too.

Tests assert this end to end: a planted secret quote is shown to be absent from the pushed request body while remaining in the on-device profile (`client/tests/sync/backend.test.ts`, `client/tests/run/import-chatgpt.test.ts`).

The server schema keeps `evidence` optional, and the deployed server has no evidence column, so an evidence-free profile is the normal case.

## 5. Per-provider paths

The capture adapters share a `CaptureAdapter` interface (`client/src/capture/types.ts`) but the inference handoff differs by provider because of what each platform allows.

### Claude (in-session, fully automatic)

Inference runs inside the user's authenticated claude.ai tab. The content script (`client/entrypoints/claude.content.ts`) fetches Claude's internal endpoints same-origin (organizations, `chat_conversations`, and a scratch-conversation `/completion` SSE that is created and deleted per call) via `client/src/inference/in-session.ts`. This works because the request originates from claude.ai with the user's session, so there is no paid API and no bot gate. The caller is rate-limit aware (handles `RateLimitError` with backoff and an honest "usage cap reached" message). The popup and `background.ts` form a small state machine: blue idle, amber while profiling, green when a fresh profile is ready, back to blue once opened, with an alarms watchdog that fails the run if the tab closes.

`selectAcrossTimeline` (`client/src/capture/select.ts`) samples conversations evenly across the whole history (oldest to newest), so the trajectory lens sees real time span within the in-session usage budget.

### ChatGPT (the user's own ChatGPT does the inference)

ChatGPT cannot run in-session inference the way Claude does: the web completion endpoint is gated by OpenAI's sentinel proof-of-work and Cloudflare Turnstile, and free users have no API access. **We do not bypass bot detection.** Instead the user's own ChatGPT runs the analysis, and the extension only captures and imports.

1. **Capture** (`client/src/capture/chatgpt.ts`, content script `client/entrypoints/chatgpt-capture.content.ts`): read-only calls to ChatGPT's internal API (`/api/auth/session`, `/backend-api/conversations`, `/backend-api/conversation/{id}`) using the page session. `linearizeMapping` walks the `current_node` parent chain to recover the active message branch (ChatGPT stores messages as an edit/regeneration tree, and message `create_time` is often null). `buildChatGptExport` (`chatgpt-export.ts`) truncates and assigns synthetic conversation ids (`c1..cN`); real ChatGPT UUIDs stay on-device in an `idMap`.
2. **Inference**, by one of two handoffs:
   - **Bridge (primary, no copy-paste):** `client/src/capture/chatgpt-bridge.ts` prefills the ChatGPT composer with the prompt+data, the **user presses send** (the extension never auto-submits, so it never touches the bot-gated path), and a `MutationObserver` reads the finished reply from the DOM. The reply-watcher's decision logic is the pure, unit-tested `watcherDecision`.
   - **Manual (always-on fallback):** the user copies/downloads the data, pastes it into a Custom GPT (or any chat), and pastes the reply back. The handoff page (`client/entrypoints/chatgpt/App.tsx`) drives both.
3. **Import** (`client/src/engine/chatgpt-import.ts`, orchestrated by `client/src/run/import-chatgpt.ts`): the GPT reply is parsed leniently (it accepts both the canonical shape and a richer `assessments.*` shape, snake_case ids, free-form evidence types, missing conversation ids), joined back to the captured export to recover timestamps and real ids, then run through the same `assembleProfile`. The badge is synced; the raw capture is cleared.

Running in a normal ChatGPT chat (rather than a Custom GPT) sidesteps the free-tier limit that only Plus users can create a GPT. The Custom GPT path still exists for the manual fallback.

## 6. The backend

`server/src/app.ts` (Hono), `server/src/db.ts` (`bun:sqlite`), entrypoint `server/src/index.ts`.

Auth is a per-user opaque bearer key generated on the device (`client/src/store/userkey.ts`), with `X-AIBadges-Invite` gating first-time registration. CORS is open on `/v1/*` because the content script calls from the provider origin (bearer only, no cookies).

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/v1/profile` | store a new profile version (self-registers with a valid invite) |
| GET | `/v1/profile` | latest profile + the user's signals |
| POST | `/v1/signals` | upsert signals; mint/keep/clear share tokens by disclosure |
| GET | `/v1/share/:token` | JSON read of one shared signal |
| GET | `/s/:token` | public, human-readable full report (PUBLIC sections only), server-rendered to mirror the in-app UI, with OpenGraph tags for social sharing |

The `/s/:token` page reuses the client's visual language (collectible type card, trait cards, momentum rows) rendered as static HTML, so a shared link looks like the in-app report but shows only sections the owner marked public.

## 7. Build and test

- Client: WXT builds each entrypoint (`popup`, `results`, `chatgpt` pages; `claude` and `chatgpt-capture` content scripts; `background`) into `client/.output/chrome-mv3`. `bun run test` runs the Vitest suite. The pure logic (engine, import, prompt, sync, capture transforms) is unit-tested; the live-DOM bridge interaction is not (it has no DOM in the test env, so its decision logic was extracted into the testable `watcherDecision`).
- Server: `bun test` runs the Hono app against an in-memory database.

## 8. Source of truth

This document and [HANDOFF](HANDOFF.md) are the current source of truth for how the system works and where it stands. The full design history lives in the git history.
