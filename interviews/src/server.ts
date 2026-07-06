import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { basicAuth } from "./auth";

export interface AppOpts {
  db: Database;
  dataDir: string;
  auth?: { user: string; pass: string };
}

export function createApp(opts: AppOpts): Hono {
  const app = new Hono();
  if (opts.auth) app.use("*", basicAuth(opts.auth.user, opts.auth.pass));
  app.get("/api/health", (c) => c.json({ ok: true }));
  return app;
}
