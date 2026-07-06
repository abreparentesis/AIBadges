import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./server";

const port = Number(process.env.PORT ?? 4620);
const dataDir = process.env.DATA_DIR ?? "./data";
const user = process.env.APP_USER;
const pass = process.env.APP_PASS;

if (process.env.NODE_ENV === "production" && (!user || !pass)) {
  throw new Error("APP_USER and APP_PASS are required in production");
}

mkdirSync(join(dataDir, "uploads"), { recursive: true });
const db = new Database(join(dataDir, "interviews.db"));

const app = createApp({
  db,
  dataDir,
  auth: user && pass ? { user, pass } : undefined,
});

export default { port, fetch: app.fetch };
console.log(`interviews app listening on :${port}`);
