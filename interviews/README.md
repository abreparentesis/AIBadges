# interviews/ — B2B validation interview companion

Internal research tooling for the AIBadges B2B validation study. Guides the live interviews
from [docs/research/b2b-validation-interviews.md](../docs/research/b2b-validation-interviews.md),
ingests call transcripts, auto-codes them with GLM 5.2 (NVIDIA API) behind a human review
gate, runs the kit's deterministic decision rules, and generates the per-segment synthesis
and the final build/no-build report.

This is **not product code**: it never touches the AIBadges privacy invariant or the
extension/backend code paths. Interviewees are pseudonymous (P1, P2, ...) in all reports.

Spec: [docs/specs/2026-07-06-interview-app-design.md](../docs/specs/2026-07-06-interview-app-design.md).
Plan: [docs/plans/2026-07-06-interview-app.md](../docs/plans/2026-07-06-interview-app.md).

## Run locally

```bash
cd interviews
bun install
GLM_FAKE=1 bun run dev     # no key needed; coding returns empty suggestions
bun test                   # 76 tests: engine boundaries, store, ingest, pipeline, API
bun run build              # builds the UI to ui/dist (served by the app)
```

With real inference:

```bash
phase run --app-id 075a8ab8-78d4-4f75-9fdd-a94ba7d1712e --env Development --path /global -- bun run dev
```

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | 4620 | |
| `DATA_DIR` | `./data` | sqlite db + `uploads/` (original transcripts) |
| `APP_USER` / `APP_PASS` | — | basic auth; **required** when `NODE_ENV=production` |
| `NVIDIA_API_KEY` | — | injected by `phase run`, never on disk |
| `GLM_MODEL` | `z-ai/glm-5.2` | |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | |
| `GLM_FAKE` | — | `1` = stub LLM for keyless dev |

## Workflow

1. **Participants** — add each recruit with screener answers; check "LinkedIn verified"
   before accepting platform panelists.
2. **Live guide** (`#/guide/<id>`) — stage timers (amber on overrun), the question bank
   (tap to mark asked), verbatim concept-block scripts, autosaving notes. Optional during
   the call; the transcript carries the data.
3. **Upload** the VTT/TXT transcript on the interview page; GLM codes it automatically.
4. **Review** — confirm/edit/reject every suggested code (quotes click through to the
   transcript); add manual codes; "mark reviewed" recomputes the segment verdict.
5. **Reports** — per-segment synthesis and the final report. Numbers come from the rules
   engine; the LLM only drafts prose, and a post-check flags any altered number.

## Deploy (Hetzner)

```bash
# on the server
sudo mkdir -p /opt/aibadges/interviews /opt/aibadges/interviews-data /etc/aibadges
rsync -a --exclude node_modules --exclude data ./interviews/ hetzner:/opt/aibadges/interviews/
ssh hetzner 'cd /opt/aibadges/interviews && bun install --production && bun run build'
printf 'APP_USER=sebastian\nAPP_PASS=<strong password>\n' | ssh hetzner 'sudo tee /etc/aibadges/interviews.env && sudo chmod 600 /etc/aibadges/interviews.env'
ssh hetzner 'sudo cp /opt/aibadges/interviews/deploy/interview-app.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now interview-app'
```

Reverse proxy (Caddy):

```
interviews.<domain> {
    reverse_proxy 127.0.0.1:4620
}
```

Basic auth is enforced by the app itself (`APP_USER`/`APP_PASS`), so the proxy stays a
plain pass-through. Backups: install `deploy/backup.sh` as a nightly cron; restore =
copy a `.db` snapshot over `DATA_DIR/interviews.db` and restart.

## Notes

- The `kit-sync` test pins the engine's thresholds to the kit doc; if the doc's numbers
  change, tests fail and force a deliberate engine review.
- Interview transcripts transit NVIDIA's API for coding (covered by the recruiting
  platforms' research consent). Nothing is ever published; everything sits behind auth.
