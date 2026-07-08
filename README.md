# AIBadges (AI Fluency Index)

Turn a person's own LLM chat history (Claude, ChatGPT) into an evidence-backed measure of how skillfully they work with AI. The result is four fluency dimensions (Delegation, Description, Discernment, Diligence), each banded strictly from verbatim quotes in the person's own words, rolled up into a 1-100 fluency score and a level from Beginner to Expert, plus an opt-in shareable badge. Claude and ChatGPT are measured separately: each provider gets its own profile, its own badge, and its own share URL.

The defining constraint: **the analysis runs in the user's own AI session, and our servers never see the raw chats.** Only the distilled badge (score, level, bands) crosses the network.

> Status (2026-07-08): fluency-only mode is the product. The earlier personality lens (cognitive type, trajectory) is deactivated behind the `FLUENCY_ONLY` flag in `client/src/config.ts`, not deleted. Both provider paths are live end to end, the production backend is deployed and hardened, and the Chrome Web Store submission pack is ready except for screenshots and a developer account. See [docs/HANDOFF.md](docs/HANDOFF.md).

## Repository layout

| Path | What it is |
|---|---|
| `client/` | The browser extension (WXT, MV3, React 19, TypeScript). Capture + inference + the results UI. This is the product. |
| `server/` | A thin backend (Hono + `bun:sqlite`, single container). Stores distilled badges and serves public share pages. Never receives raw chats. |
| `interviews/` | A separate B2B study tool (live interview guide, transcript coding, reports). Not product code. See [interviews/README.md](interviews/README.md). |
| `docs/` | The authoritative docs (below), plus design specs and research notes. |
| `docs/ARCHITECTURE.md` | How the system works: data model, the inference engine, the privacy boundary, the per-provider paths, the backend. **Read this first.** |
| `docs/DEPLOYMENT.md` | Server install on any VM, pointing the extension at your own backend, Chrome Web Store publishing. |
| `docs/HANDOFF.md` | Current state, known limitations, and a first-week checklist for a new team. **Read this second.** |
| `docs/store/` | The Chrome Web Store submission pack: listing copy, permission justifications, and the privacy policy to host. |
| `.context/architecture/` | A LikeC4 model of the system (optional; renders with the LikeC4 tooling). |

## How it works (one paragraph)

The extension captures the user's conversation history from the AI provider's own web app using the user's existing session, then extracts short verbatim evidence units in two passes (a general sweep plus a reaction-focused sweep) into a persistent local evidence pool per provider. Re-runs are incremental: a versioned scan set fingerprints which conversations have already been analyzed, so only new or changed ones are re-read, and an extractor upgrade bumps the version to force a full rescan. The pooled evidence is then scored: each of the four fluency dimensions gets a band that the code caps at what its surviving evidence actually supports, an adversarial audit turn re-judges every band against its quotes and lowers anything unearned, and the headline `fluencyScore` (1-100) is derived from the audited bands with a ceiling of 80 for chat-only evidence (the Expert range is reserved for future agentic-source ingestion). The full result, quotes included, stays on the device; only the badge syncs. For **Claude**, inference runs in-session in the user's claude.ai tab. For **ChatGPT**, the extension operates the user's own logged-in session in background tabs, using throwaway conversations it deletes afterwards, with a manual export/paste fallback.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

## Quickstart

Prerequisites: [Bun](https://bun.sh) (toolchain for both client and server) and a Chromium browser for loading the unpacked extension.

### Extension (client)

```bash
cd client
bun install
bun run test     # vitest unit suite (234 tests)
bun run build    # outputs the unpacked extension to client/.output/chrome-mv3
# bun run zip    # store-uploadable zip at client/.output/client-<version>-chrome.zip
# bun run dev    # WXT dev mode with HMR
```

Then load it: open `chrome://extensions`, enable Developer mode, **Load unpacked**, and select `client/.output/chrome-mv3`. Use it by opening claude.ai or chatgpt.com (signed in) and clicking the toolbar icon.

Build-time configuration lives in a gitignored `client/.env` (templates in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)). Without it the build falls back to the hosted, permissionless backend, so scoring and sharing work out of the box with nothing to configure. Point `WXT_AIBADGES_BACKEND` at your own deployment if you'd rather not use the hosted one; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Backend (server)

```bash
cd server
bun install
bun test
bun run dev   # serves on :8095 (override with PORT)
```

The backend stores distilled badges in SQLite (`DB_PATH`, default `./data/aibadges.db`). Registration is permissionless by default: anyone who installs the extension can push and share a badge. Set `INVITE_TOKEN` (and the matching client `WXT_AIBADGES_INVITE`) only if you want to gate first-time registration on your own deployment. Production setup, reverse proxy, backups, and upgrades are all in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Privacy model (non-negotiable)

Raw chats never reach our servers. The profile's `evidence` array (verbatim quotes) is stripped by `chatPrivateProfile()` (`client/src/sync/backend.ts`) before any network push; only the badge and opaque evidence ids cross. The local evidence pool (`aibadges:evidencePool:*` in extension storage) never syncs. Chats are processed only by the user's own AI provider (Anthropic or OpenAI), which is the user's existing relationship, not an exposure to us. This invariant is enforced in code and covered by tests. Do not add a code path that sends conversation text, quotes, or the capture payload to any server.

## Toolchain

WXT 0.20 (MV3 extension framework), React 19, Zod 4, Vitest (client tests), Hono 4 + `bun:sqlite` (server), Bun runtime throughout. No paid inference API is used anywhere in the product; all model calls run in the user's own subscription session.
