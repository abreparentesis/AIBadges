# AIBadges handoff

For the team picking this up. Read the [README](../README.md) and [ARCHITECTURE](ARCHITECTURE.md) first; this doc covers state, limitations, how to deploy, and what to do next.

> There is also an auto-generated `docs/handoff/HANDOFF.md` written by the previous author's tooling. It is a historical session log and is stale (it predates the ChatGPT work and the personality pivot). This file is the current source of truth.

## Current state

| Area | State |
|---|---|
| Claude path (capture → in-session inference → profile → badge sync) | Live, validated end to end in real runs. |
| Profile report UI (gamified, evidence-auditable, per-section private/public sharing) | Done. |
| Backend (store badge, share tokens, server-rendered `/s/:token` report) | Deployed at `aibadges-api.mindmaterial.io`. |
| ChatGPT capture (read-only history fetch + linearization) | Done, verified against the live API during a spike. |
| ChatGPT import (lenient parse of the GPT reply → same anchoring as Claude) | Done, unit-tested for both reply shapes. |
| ChatGPT manual handoff (export → GPT → paste back) | Done. |
| ChatGPT in-page bridge (prefill composer → user sends → read reply) | Built; **DOM interaction not yet verified against the live chatgpt.com UI.** |
| Credibility hardening (evidence anchoring, confidence grading, quote verification) | Done in the engine; deeper validation (vs a real questionnaire, zkTLS provenance) is future work. |
| B2B validation study tooling (`interviews/` app: live guide, GLM transcript coding, decision rules, reports) | Built and tested (76 tests, real GLM 5.2 smoke passed); deploy to the Hetzner box pending — see [interviews/README.md](../interviews/README.md). Interview kit: [research/b2b-validation-interviews.md](research/b2b-validation-interviews.md). |

Tests: client Vitest suite and server `bun test` both pass (`cd client && bun run test`; `cd server && bun test`). Builds are clean.

## Known limitations and risks

- **The ChatGPT bridge is coupled to chatgpt.com's DOM.** Composer selectors, the "generation finished" signal (stop-button absence), and the assistant-message structure can change when OpenAI ships UI updates. `client/src/capture/chatgpt-bridge.ts` uses multi-fallback selectors and a stability window, and any miss degrades to the manual export/paste path with an in-page error hint, but the happy path needs a live run to confirm and will need occasional selector maintenance. The pure decision logic (`watcherDecision`) is unit-tested; the DOM reads are not (no DOM in the test env).
- **Bridge payload size.** A large capture (the default is ~30 conversations) can exceed a single free-tier ChatGPT message. The handoff page warns when the capture is large and points to the manual file-upload fallback. Chunking is not implemented (see roadmap).
- **Model variance.** ChatGPT-derived profiles come from whatever model the user's tier runs, which differs from Claude. This is fine for a single user's self-view but is a calibration risk if you later rank or compare users across providers.
- **Concurrent dual-provider runs.** The run status model assumes one profiling run at a time. Running a Claude in-session profile and a ChatGPT bridge import simultaneously is not handled (the ChatGPT completion would mark status `done`). Not a realistic user flow, but worth knowing.
- **No Chrome Web Store packaging.** The extension is distributed as an unpacked build today. Store submission (icons, listing, review) is not set up.
- **Bot detection.** We deliberately never bypass OpenAI's sentinel proof-of-work or Turnstile, and never auto-submit in the bridge. Keep it that way. The in-session ChatGPT completion path and an earlier proof-of-work solver were removed on purpose; do not reintroduce them.

## Environment and secrets

Build/run configuration is via gitignored `.env` files; copy-pasteable templates are in [ENVIRONMENT.md](ENVIRONMENT.md) (literal `.env.example` files are intentionally not committed because the toolchain blocks writing `.env*` paths).

- **Client** (`client/.env`, baked into the build by WXT): `WXT_AIBADGES_BACKEND`, `WXT_AIBADGES_INVITE`, `WXT_AIBADGES_GPT_URL`. All have safe fallbacks in `client/src/config.ts` (production backend, empty invite, the current Custom GPT url).
- **Server** (`server/.env`): `INVITE_TOKEN` (optional; empty means permissionless registration), `PORT` (default 8095), `DB_PATH` (default `./data/aibadges.db`).

Registration is permissionless by default: anyone who installs the extension can push and share a badge, with no shared secret to distribute. Set `INVITE_TOKEN` (and the matching client `WXT_AIBADGES_INVITE`) only if you want to gate first-time registration. There are no third-party API keys anywhere in the product (all inference is in the user's own session).

## Deployment runbook

**Backend.** Containerized; runs behind a reverse proxy.

```bash
cd server
# optional: set INVITE_TOKEN in server/.env to gate registration (omit for permissionless)
docker compose up -d --build      # binds 127.0.0.1:8095, SQLite in ./data (mounted volume)
```

The production instance runs under a reverse proxy (Caddy) terminating TLS at `aibadges-api.mindmaterial.io` and forwarding to `127.0.0.1:8095`. SQLite persists in the mounted `data/` volume; back that up to retain badges. To move it, stand up the container anywhere, point a public HTTPS hostname at it, and set `WXT_AIBADGES_BACKEND` in the client build to that hostname.

**Extension.** `cd client && bun run build` produces `client/.output/chrome-mv3`, which is what users load unpacked today. For wider distribution, package that directory for the Chrome Web Store (not yet configured).

## What needs a human (founder/team), not code

- **A live end-to-end ChatGPT bridge run** on a logged-in account, to confirm the composer prefill and reply read work against the current UI and to tune selectors if needed. This is the one open verification item on the new feature.
- **Judging whether the profile "feels true"** on real accounts (the long-standing validation task). Only a person can score that.
- **The Custom GPT** (for the manual fallback) lives on OpenAI's platform under the founder's account. The hardened instructions that configure it are kept with the founder (and in the git history of the design specs); the bridge path does not require it.

## Roadmap / next steps

1. Live-verify and harden the ChatGPT bridge (selectors, a version canary that auto-falls-back to manual if the DOM contract breaks).
2. Chunk large captures across multiple bridge messages so big histories fit free-tier limits.
3. zkTLS provenance: wrap the capture fetches (TLSNotary / Reclaim / zkPass) so a shared badge can carry a proof that its evidence is real chat data from a genuine account, verifiable without revealing the chats. This attaches to the **capture** step (the chatgpt.com / claude.ai data fetch) and is independent of how the GPT reply gets back, so it composes with either handoff. It proves data authenticity, not inference validity.
4. Validate the cognitive-type and trajectory output against a real questionnaire to calibrate the credibility claims.
5. Chrome Web Store packaging and a real onboarding flow.

## Gotchas

- **Toolchain is Bun**, not npm. Use `bun install` / `bun run` in both `client/` and `server/`. The client tracks a `package-lock.json` and the server a `bun.lock`; either installs fine under Bun. The server uses `bun:sqlite` (a Bun built-in), so it must run under Bun, not Node.
- **Content-script CORS.** Backend calls originate from the provider origin (claude.ai / chatgpt.com) under MV3, so `/v1/*` is CORS-open with bearer auth (no cookies). Keep that when changing the backend.
- **The server schema must keep `evidence` optional.** The client strips evidence before pushing; if you tighten the server schema to require it, the badge-only push will 400.
- **Personal tooling in the repo.** `.claude/`, `.mcp.json` (points at the previous author's local DevPlanner path), and the board/agent sections of `CLAUDE.md` are the previous author's Claude Code setup. They do not affect the build and can be ignored or removed. `CLAUDE.md` also contains useful project conventions worth skimming.
- **Git history.** Work was done on a `feat/chatgpt-capture` branch and fast-forwarded into `main`; `main` is the integration branch and is current. Commits stage files by name (no `git add -A`).
- **The capture payload is on-device only.** It lives at `chrome.storage.local['aibadges:chatgpt:capture']` and is cleared after a successful import. It is never sent to a server. Keep it that way.
