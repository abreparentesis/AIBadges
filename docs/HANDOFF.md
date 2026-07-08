# AIBadges handoff

For the team picking this up. Read the [README](../README.md) and [ARCHITECTURE](ARCHITECTURE.md) first; this doc covers current state, known limitations, what to do first, and gotchas. Deployment lives in [DEPLOYMENT.md](DEPLOYMENT.md).

> Where any document conflicts with the code, the code wins. README, ARCHITECTURE, DEPLOYMENT, and this doc were all brought current together at handoff time.

## Current state

The product is **fluency-only**: four fluency dimensions (Delegation, Description, Discernment, Diligence), evidence-capped bands, an adversarial audit turn that re-judges every band against its quotes, a `fluencyScore` of 1-100 capped at 80 for chat-only evidence, and levels Beginner / Intermediate / Advanced / Expert. The personality lens (cognitive type, trajectory) is deactivated by the `FLUENCY_ONLY` flag in `client/src/config.ts`; it is gated, not deleted.

| Area | State |
|---|---|
| Claude path (capture → in-session inference → scored profile → badge sync) | Live, validated end to end in real runs. |
| ChatGPT path (automated background-tab run: capture → analysis in throwaway conversations → import) | Live. The run checkpoints per batch, resumes after mid-flight failures, and deletes its conversations. A manual export/paste fallback remains. |
| Per-provider separation | Claude and ChatGPT are measured separately: each provider has its own local storage slots, its own backend user key (`client/src/store/userkey.ts`), and its own share URL. |
| Score stability machinery | A persistent local evidence pool per provider (`aibadges:evidencePool:*`, capped at 200 units, verbatim quotes, LOCAL ONLY, never synced); incremental extraction via a fingerprint scan set (`aibadges:scanned:*`, versioned by `SCANNER_VERSION` in `client/src/store/scanset.ts` so extractor upgrades force a full rescan); two-pass extraction (a general sweep plus a reaction-focused sweep). |
| Publish state | Survives re-runs: a badge marked public stays public, and a re-run republishes fresh scores to the same share URL. |
| Results UI (evidence-auditable bands, per-provider sharing, "try next" actions) | Done. |
| Backend | Deployed at `aibadges-api.mindmaterial.io` (permissionless registration). Hardened: per-key sliding-window rate limits (writes 30 per 5 min per bearer key; public `/s/` and `/og/` pages 120 per minute per client), 256 KB body cap on `/v1/*`, security headers (nosniff everywhere; CSP + no-referrer + frame-deny on `/s/` pages), compose healthcheck on `/health`, docker log rotation, and `server/scripts/backup.sh` (consistent `VACUUM INTO` snapshots, keeps 14, cron-able). |
| Chrome Web Store | Submission pack ready in [store/CHROME_WEB_STORE.md](store/CHROME_WEB_STORE.md) (listing copy, permission justifications, privacy policy, checklist). Missing only screenshots and a registered developer account. |

Tests: client Vitest suite (234 tests) and server `bun test` both pass (`cd client && bun run test`; `cd server && bun test`). Builds are clean.

## Known limitations and risks

- **Chat-only ceiling of 80.** The `fluencyScore` derivation in `client/src/engine/assemble.ts` caps chat-derived scores at 80, and the Expert level band is reachable only once an agentic source (Claude Code / Codex transcripts) is ingested. That ingestion path does not exist yet, so today no user can score above 80 or reach Expert. This is deliberate honesty, not a bug.
- **Cross-provider judge asymmetry.** The two providers are scored by different judges (the user's own Claude vs the user's own ChatGPT). In the local eval harness the GPT-side judge measured roughly one band more lenient than the Claude-side judge. Per-provider scores are self-consistent, but do not compare or rank across providers until this is calibrated; hardening the eval harness is the open lever.
- **ChatGPT hidden-tab throttling is the flakiest surface.** The automated run operates hidden background tabs, and browsers throttle their timers to as little as one tick per minute. `client/src/capture/chatgpt-autorun.ts` compensates (per-batch checkpoints, heartbeats to the service worker watchdog, timeouts gated on a minimum number of real polls), but this remains the most fragile path and is coupled to chatgpt.com internals. Expect occasional maintenance when OpenAI ships changes.
- **Construct validity is unproven.** No public ground-truth dataset anchors the scores. The bands are internally disciplined (evidence-capped, adversarially audited), but nothing external calibrates whether an "Advanced" here means what a hiring manager would call advanced. Treat the score as evidence-backed and self-consistent, not externally validated.
- **Bot detection stance.** The extension never bypasses OpenAI's sentinel proof-of-work or Cloudflare Turnstile. The automated run submits through the page's own composer inside the user's logged-in session and backs off when a challenge is present (`hasChallenge` in `client/src/capture/chatgpt-bridge.ts`). An earlier in-session completion path and proof-of-work solver were removed on purpose; do not reintroduce them.

## Environment and secrets

Build/run configuration is via gitignored `.env` files; copy-pasteable templates are in [ENVIRONMENT.md](ENVIRONMENT.md) (literal `.env.example` files are intentionally not committed because the toolchain blocks writing `.env*` paths).

- **Client** (`client/.env`, baked into the build by WXT): `WXT_AIBADGES_BACKEND`, `WXT_AIBADGES_INVITE`, `WXT_AIBADGES_GPT_URL`. All have safe fallbacks in `client/src/config.ts` (production backend, empty invite, the current Custom GPT url).
- **Server** (`server/.env`): `INVITE_TOKEN` (optional; empty means permissionless registration), `PORT` (default 8095), `DB_PATH` (default `./data/aibadges.db`).

Registration is permissionless by default: anyone who installs the extension can push and share a badge, with no shared secret to distribute. Set `INVITE_TOKEN` (and rebuild the client with the matching `WXT_AIBADGES_INVITE`) only if you want to gate first-time registration. There are no third-party API keys anywhere in the product (all inference is in the user's own session).

## Deployment

The full runbook is [DEPLOYMENT.md](DEPLOYMENT.md): server install from scratch on any VM (Docker or bare Bun), reverse proxy, backups, upgrades, restore, pointing the extension at your own backend, and Chrome Web Store publishing.

Reference production facts, for orientation: the host directory `/opt/aibadges-backend` is an rsync'd copy of the repo's `server/` directory (not a git clone); a deploy is rsync (excluding `.env`, `data/`, `node_modules/`, `.git`) followed by `docker compose up -d --build`; the container binds `127.0.0.1:8095`; a native Caddy reverse-proxies `aibadges-api.mindmaterial.io` with automatic TLS; SQLite persists in `./data` (mode 0700). Verify with `GET /health` returning `{"ok":true}`.

## First week checklist for the new team

1. Register a Chrome Web Store developer account ($5 fee, verified publisher email, 2FA), and complete the EU trader declaration.
2. Host the privacy policy ([store/PRIVACY_POLICY.md](store/PRIVACY_POLICY.md)) at a public URL and set it in the dashboard.
3. Take the listing screenshots (1280x800: popup on claude.ai, the results page, a share page). They are the only asset still missing from the submission pack.
4. Decide invite-gating for your deployment: keep permissionless registration, or set `INVITE_TOKEN` on the server and rebuild the client with `WXT_AIBADGES_INVITE`.
5. Set up the backup cron on the server host (`server/scripts/backup.sh`; see [DEPLOYMENT.md](DEPLOYMENT.md)).
6. Read the eval harness under `client/eval/` (extraction/synthesis/audit prompts, cached run artifacts, and the chatbench / prism / wildchat datasets; there is no separate doc, the artifacts are the doc). The cross-provider judge-leniency finding came from here, and hardening this harness is the prerequisite for any scoring change.

## Roadmap / next steps

1. Harden the eval harness and calibrate the GPT-side judge against the Claude-side judge, so cross-provider scores become comparable.
2. Agentic-source ingestion (Claude Code / Codex transcripts) to unlock the Expert range and scores above 80.
3. Chrome Web Store publication (the pack is ready; see the checklist above) and a real onboarding flow.
4. A ground-truth validation study to give the scores external construct validity.
5. zkTLS provenance: wrap the capture fetches (TLSNotary / Reclaim / zkPass) so a shared badge can carry a proof that its evidence is real chat data from a genuine account, verifiable without revealing the chats. This attaches to the capture step and proves data authenticity, not inference validity.

## Gotchas

- **Toolchain is Bun**, not npm. Use `bun install` / `bun run` in both `client/` and `server/`. The server uses `bun:sqlite` (a Bun built-in), so it must run under Bun, not Node.
- **`FLUENCY_ONLY` gates, it does not delete.** The personality lens (cognitive type, trajectory) is switched off end to end by the flag in `client/src/config.ts`: not computed, not rendered, not synced. Flip it to false to reactivate. Do not "clean up" the gated code paths without understanding this.
- **Bump `SCANNER_VERSION` when the extractor changes.** Incremental extraction trusts the scan set (`client/src/store/scanset.ts`): a conversation marked scanned is never re-read. If you improve an extraction prompt or model and forget to bump that provider's version, old conversations keep their old, weaker evidence forever.
- **The evidence pool is local only.** `aibadges:evidencePool:*` holds verbatim quotes and must never sync. The privacy boundary is `chatPrivateProfile()` in `client/src/sync/backend.ts`, covered by tests; do not add a code path that sends conversation text, quotes, or the capture payload to any server.
- **Content-script CORS.** Backend calls originate from the provider origin (claude.ai / chatgpt.com) under MV3, so `/v1/*` is CORS-open with bearer auth (no cookies). Keep that when changing the backend.
- **The server schema must keep `evidence` optional.** The client strips evidence before pushing; if you tighten the server schema to require it, the badge-only push will 400.
- **Commits stage files by name** (no `git add -A`); `main` is the integration branch and is current.
