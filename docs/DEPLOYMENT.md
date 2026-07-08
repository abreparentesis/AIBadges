# AIBadges deployment guide

How to stand up the backend on any Linux VM, point the extension at it, and publish the extension to the Chrome Web Store. The reference production deployment (`aibadges-api.mindmaterial.io`, a Hetzner VM) is used as the worked example throughout; nothing about it is special, and every step works on any host that runs Docker.

## 1. Server install from scratch

### Prerequisites

- A Linux VM (any distro that runs Docker).
- Docker Engine with the compose plugin (`docker compose version` should work).
- A domain or subdomain with an A record pointing at the VM. TLS is handled by the reverse proxy.

Nothing else: the backend is a single container (Bun + Hono + `bun:sqlite`) with SQLite on a mounted volume, so there is no external database to provision.

### Get the code onto the host

Only the repo's `server/` directory needs to be on the host. Either clone the repo:

```bash
git clone https://github.com/abreparentesis/AIBadges.git
cd AIBadges/server
```

or do what the reference deployment does: keep `/opt/aibadges-backend` as an rsync'd copy of `server/` (not a git clone), pushed from a working checkout:

```bash
rsync -av --delete \
  --exclude .env --exclude data/ --exclude node_modules/ --exclude .git \
  server/ user@your-host:/opt/aibadges-backend/
```

The excludes matter: `.env` and `data/` are host-local state that a deploy must never overwrite.

### Configure

Create `server/.env` (gitignored; template in [ENVIRONMENT.md](ENVIRONMENT.md)):

```dotenv
# Optional. Empty (the default) means permissionless registration: anyone who
# installs the extension can push and share a badge. Set it, AND rebuild the
# client with the matching WXT_AIBADGES_INVITE, to gate first-time registration.
INVITE_TOKEN=
```

The other two variables have working defaults and are already set by `docker-compose.yml`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8095` | Listen port inside the container. |
| `DB_PATH` | `/data/aibadges.db` | SQLite file. `/data` is the mounted `./data` host directory. (Bare-metal default: `./data/aibadges.db`.) |
| `INVITE_TOKEN` | empty | Empty = permissionless registration. Non-empty = first-time registration requires the matching client build. |

### Start

```bash
cd /opt/aibadges-backend   # or wherever server/ lives
mkdir -p data && chmod 700 data
docker compose up -d --build
```

What the compose file gives you:

- The container binds `127.0.0.1:8095` only. It is never exposed directly; public ingress goes through the reverse proxy.
- A healthcheck against `/health` (30s interval), so `docker ps` shows `healthy`/`unhealthy` honestly.
- Docker log rotation (json-file, 10 MB x 3 files).
- SQLite persisted in `./data` on the host.

The app itself ships hardening (see `server/src/hardening.ts` and `server/src/app.ts`): per-key sliding-window rate limits (writes: 30 per 5 minutes per bearer key; public `/s/` and `/og/` pages: 120 per minute per client), a 256 KB body cap on `/v1/*`, and security headers (`nosniff` everywhere; CSP, no-referrer, and frame-deny on the `/s/` share pages).

### Reverse proxy

The container speaks plain HTTP on localhost; a reverse proxy terminates TLS on the public hostname. The reference deployment uses a native Caddy install, which handles certificates automatically:

```caddyfile
aibadges-api.example.com {
    reverse_proxy 127.0.0.1:8095
}
```

Equivalent nginx location block (certificates via certbot or your usual tooling):

```nginx
server {
    listen 443 ssl;
    server_name aibadges-api.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:8095;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Keep the `X-Forwarded-For` header: the rate limiter identifies unauthenticated clients by the first forwarded hop (`clientId()` in `server/src/hardening.ts`).

### Verify

```bash
curl -fsS http://127.0.0.1:8095/health          # on the host
curl -fsS https://aibadges-api.example.com/health   # through the proxy
```

Both must return `{"ok":true}`. If the first works and the second does not, the problem is the proxy or DNS, not the app.

### Backups

`server/scripts/backup.sh` takes a consistent snapshot of the live SQLite database using `VACUUM INTO` (a transactional copy, safe while the server is serving writes) and keeps the newest 14 snapshots in the same `data/` directory.

```bash
/opt/aibadges-backend/scripts/backup.sh          # run once to test
```

Cron it (the schedule is already documented in the script header):

```cron
17 4 * * *  /opt/aibadges-backend/scripts/backup.sh  >> /var/log/aibadges-backup.log 2>&1
```

The script takes optional arguments (`backup.sh [container-name] [host-data-dir]`) if you renamed the container or moved the data directory.

### Upgrades

1. Take a backup (`scripts/backup.sh`).
2. Update the code on the host: `git pull` in a clone, or re-run the rsync command above from your checkout.
3. Rebuild and restart:

```bash
cd /opt/aibadges-backend
docker compose up -d --build
```

4. Verify `/health` returns `{"ok":true}`.

The database lives in `data/` on the host and is untouched by the rebuild. Schema setup is idempotent (`CREATE TABLE IF NOT EXISTS` in `server/src/db.ts`), so restarts against an existing database are safe.

### Restore from backup

Snapshots are plain SQLite files. To roll back:

```bash
cd /opt/aibadges-backend
docker compose down
cp data/backup-YYYYMMDD-HHMMSS.db data/aibadges.db
rm -f data/aibadges.db-wal data/aibadges.db-shm   # stale WAL state must not outlive the file it belongs to
docker compose up -d
curl -fsS http://127.0.0.1:8095/health
```

### Running without Docker

The server runs directly under Bun (it uses `bun:sqlite`, a Bun built-in, so it must be Bun, not Node):

```bash
cd server
bun install
bun run start     # PORT=8095, DB_PATH=./data/aibadges.db by default
```

Put it under systemd (or any supervisor) for restarts. The reverse proxy setup is identical. For backups without a container, run the same `VACUUM INTO` directly:

```bash
cd server
bun -e "const {Database}=require('bun:sqlite'); const db=new Database('./data/aibadges.db'); db.exec(\"VACUUM INTO './data/backup-manual.db'\"); db.close();"
```

## 2. Pointing the extension at your server

The backend URL is baked into the extension at build time. Create `client/.env`:

```dotenv
WXT_AIBADGES_BACKEND=https://aibadges-api.example.com

# Only if your server sets INVITE_TOKEN; must match it exactly. Otherwise leave empty.
WXT_AIBADGES_INVITE=
```

Then rebuild:

```bash
cd client
bun install
bun run build
```

Two things to know:

- WXT bakes `WXT_*` variables in at compile time (fallbacks in `client/src/config.ts`), so changing `.env` always requires a rebuild. With no `.env` at all, the build points at the hosted backend `https://aibadges-api.mindmaterial.io`, which is permissionless.
- `client/wxt.config.ts` lists the backend origin in `host_permissions` (`https://aibadges-api.mindmaterial.io/*`). When you switch to your own hostname, replace that entry so the extension can call your API.

One server-side constant to update once the extension is published: `EXTENSION_URL` in `server/src/app.ts` (line 60) is the "Get the Chrome extension" link rendered on every public share page. It currently points at the GitHub repo; swap it to the Chrome Web Store listing URL once the listing is live.

## 3. Chrome Web Store publishing

Build the store zip from a clean production build:

```bash
cd client
bun install
bun run build   # sanity-check the production build compiles
bun run zip     # produces client/.output/client-<version>-chrome.zip
```

Everything you paste into the developer dashboard (single-purpose description, all six permission justifications, data-use disclosure, listing copy, pre-submission checklist) is in [store/CHROME_WEB_STORE.md](store/CHROME_WEB_STORE.md). Do not rewrite that content here or elsewhere; it is the single source of truth for the listing. The privacy policy is served by the backend itself at `/privacy` (`server/src/privacy.ts`; text source of truth in [store/PRIVACY_POLICY.md](store/PRIVACY_POLICY.md), keep them in sync) — for the reference deployment that is https://aibadges-api.mindmaterial.io/privacy, and that URL goes in the dashboard's privacy policy field.

### Distributing prebuilt zips (before or alongside the store)

End users should not need Bun. Until the store listing is live (and for beta channels after), attach the built zip to a GitHub Release so people can install without a toolchain:

```bash
cd client && bun run zip
gh release create v$(node -p "require('./package.json').version") \
  .output/client-*-chrome.zip \
  --title "AI Fluency Index v$(node -p "require('./package.json').version")" \
  --notes "Unzip, open chrome://extensions, enable Developer mode, Load unpacked, select the unzipped folder."
```

Out-of-store installs have two inherent limits, so say them plainly in the release notes: Chrome shows a developer-mode notice, and nothing auto-updates (users grab the next release manually). Self-hosting a `.crx` is not an option; Chrome only accepts non-store `.crx` installs through enterprise policy.

### Version bump flow (every subsequent release)

1. Bump `version` in `client/package.json`. WXT derives the manifest version from it (`wxt.config.ts` does not override it).
2. `bun run zip` produces `client/.output/client-<new-version>-chrome.zip`.
3. Upload the zip as a new draft in the [developer dashboard](https://chrome.google.com/webstore/devconsole) and submit for review.
4. Review timeline: routine updates to an established listing usually clear within a few business days. The first submission, and any update that changes permissions or host permissions, gets deeper scrutiny and can take a week or more. Plan releases accordingly; there is no expedite button.

### Review warning: the chatgpt.com automation

Expect the reviewer to question the extension's behavior on chatgpt.com: it operates the user's own logged-in ChatGPT session in background tabs, submits analysis prompts, reads replies through the same backend API the page uses, and deletes the temporary conversations afterwards. This is user-initiated, runs entirely in the user's own session, and never bypasses OpenAI's bot gates. The exact justification wording is in [store/CHROME_WEB_STORE.md](store/CHROME_WEB_STORE.md) under the `https://chatgpt.com/*` host-permission section; keep any reviewer correspondence consistent with it.
