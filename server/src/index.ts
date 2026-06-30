import { createApp } from './app';
import { createDb } from './db';

const dbPath = process.env.DB_PATH ?? './data/aibadges.db';
// Optional. When set, a brand-new user key must present it to register. When empty (the default),
// registration is permissionless: anyone who installs the extension can push and share a badge.
const inviteToken = process.env.INVITE_TOKEN ?? '';
const port = Number(process.env.PORT ?? 8095);

const db = createDb(dbPath);
const app = createApp(db, { inviteToken });

const mode = inviteToken ? 'invite-gated registration' : 'permissionless registration';
console.log(`aibadges-backend listening on :${port} (db: ${dbPath}) [${mode}]`);

export default { port, fetch: app.fetch };
