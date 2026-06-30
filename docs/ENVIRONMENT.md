# Environment configuration

`.env` files are gitignored (and blocked from being committed) so no secrets land in the repo. Create them locally from the templates below. Every value has a safe fallback, so a local build works without any `.env` at all; you only need these to point at your own backend/invite.

## `client/.env`

WXT bakes `WXT_*` vars into the build at compile time (see `client/src/config.ts` for the fallbacks).

```dotenv
# Backend base URL the extension syncs the badge to.
# Fallback: https://aibadges-api.mindmaterial.io
WXT_AIBADGES_BACKEND=https://aibadges-api.mindmaterial.io

# Optional. Only needed for an invite-gated backend; must match that server's
# INVITE_TOKEN. Leave empty for the default permissionless backend. Fallback: "" (empty).
WXT_AIBADGES_INVITE=

# The AIBadges Custom GPT used by the manual ChatGPT fallback (not needed for the bridge).
# Fallback: the current published GPT url in src/config.ts.
WXT_AIBADGES_GPT_URL=https://chatgpt.com/g/g-6a26b204b0748191af3193558989e4bd-aibadges
```

## `server/.env`

```dotenv
# Optional. Leave empty for permissionless registration (anyone who installs the
# extension can push and share a badge). Set it (and the matching client
# WXT_AIBADGES_INVITE) only to gate first-time registration on your deployment.
INVITE_TOKEN=

# Optional. Defaults shown.
PORT=8095
DB_PATH=./data/aibadges.db
```

There are no third-party API keys anywhere in the product. All inference runs in the user's own AI session (Claude in-session, or the user's own ChatGPT). There is no required shared secret; `INVITE_TOKEN` is an optional gate you can set if you don't want permissionless registration.
