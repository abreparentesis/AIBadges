# AIBadges

Turn a person's own LLM chat history (Claude, ChatGPT) into an evidence-backed **living profile** of how they think, plus opt-in, shareable **badges** distilled from it. The profile is behavioral (inferred from what the person actually wrote, not a self-report quiz) and every claim links to the quotes behind it.

The defining constraint: **the analysis runs in the user's own AI session, and our servers never see the raw chats.** Only the distilled badge crosses the network.

> Status (2026-06-08): v1 shipped. Claude path is live and validated end to end. ChatGPT path (capture → the user's own ChatGPT → import) is built with two handoff modes (an in-page bridge and a manual export/import fallback); the bridge's live-DOM interaction with chatgpt.com has not yet been verified against the production UI. See [docs/HANDOFF.md](docs/HANDOFF.md).

## Repository layout

| Path | What it is |
|---|---|
| `client/` | The browser extension (WXT, MV3, React 19, TypeScript). Capture + inference + the profile/report UI. This is the product. |
| `server/` | A thin backend (Hono + `bun:sqlite`). Stores distilled badges and serves public share pages. Never receives raw chats. |
| `interviews/` | Internal research tooling for the B2B validation study: live interview guide, transcript coding, decision rules, reports. Not product code. See [interviews/README.md](interviews/README.md). |
| `docs/` | Design specs, the brainstorm context, and the two authoritative docs below. |
| `docs/ARCHITECTURE.md` | How the whole thing works: data model, the inference engine, the privacy boundary, the per-provider paths, the backend. **Read this first.** |
| `docs/HANDOFF.md` | Current state, known limitations, the deployment runbook, the roadmap, and gotchas. **Read this second.** |
| `.context/architecture/` | A LikeC4 model of the system (optional; renders with the LikeC4 tooling). |

`.claude/` and `.mcp.json` are the previous author's personal Claude Code tooling. They are not needed to build, run, or develop the project and can be ignored or removed (see HANDOFF, "Gotchas").

## How it works (one paragraph)

The extension captures the user's conversation history from the AI provider's own web app using the user's existing session, then runs an inference pipeline that extracts short behavioral evidence units (verbatim quotes), synthesizes how the person thinks plus a cognitive type and trajectory, and anchors every claim to its evidence (dropping anything unbacked, grading confidence by how much evidence supports it across how many distinct conversations). The result is stored locally with its quotes for an auditable view; only the badge (claims, type, trajectory, opaque evidence ids) is synced to the backend. For **Claude**, inference runs in-session in the user's claude.ai tab. For **ChatGPT**, the user's own ChatGPT does the inference (free, no API), and the extension only captures and imports the result.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture.

## Quickstart

Prerequisites: [Bun](https://bun.sh) (toolchain for both client and server) and a Chromium browser for loading the unpacked extension.

### Extension (client)

```bash
cd client
bun install
bun run test     # vitest unit suite
bun run build    # outputs the unpacked extension to client/.output/chrome-mv3
# bun run dev    # WXT dev mode with HMR
```

Then load it: open `chrome://extensions`, enable Developer mode, **Load unpacked**, and select `client/.output/chrome-mv3`. Use it by opening claude.ai or chatgpt.com (signed in) and clicking the AIBadges toolbar icon.

Build-time configuration lives in a gitignored `client/.env` (templates in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)). Without it the build falls back to a hosted, permissionless backend, so profiling and sharing work out of the box with nothing to configure. Point `WXT_AIBADGES_BACKEND` at your own deployment if you'd rather not use the hosted one.

### Backend (server)

```bash
cd server
bun install
bun test
bun run dev   # serves on :8095 (override with PORT)
```

The backend stores distilled badges in SQLite (`DB_PATH`, default `./data/aibadges.db`). Registration is permissionless by default: anyone who installs the extension can push and share a badge. Set `INVITE_TOKEN` (and the matching client `WXT_AIBADGES_INVITE`) only if you want to gate first-time registration on your own deployment. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) and the deployment runbook in [docs/HANDOFF.md](docs/HANDOFF.md).

## Privacy model (non-negotiable)

Raw chats never reach our servers. The profile's `evidence` array (verbatim quotes) is stripped by `chatPrivateProfile()` (`client/src/sync/backend.ts`) before any network push; only the badge and opaque evidence ids cross. Chats are processed only by the user's own AI provider (Anthropic or OpenAI), which is the user's existing relationship, not an exposure to us. This invariant is enforced in code and covered by tests. Do not add a code path that sends conversation text, quotes, or the capture payload to any server.

## Toolchain

WXT 0.20 (MV3 extension framework), React 19, Zod 4, Vitest (client tests), Hono 4 + `bun:sqlite` (server), Bun runtime throughout. No paid inference API is used anywhere in the product; all model calls run in the user's own subscription session.
