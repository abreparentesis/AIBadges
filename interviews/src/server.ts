import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { basicAuth } from "./auth";
import { mountApi } from "./api/routes";
import type { LlmClient } from "./llm/client";
import { initSchema, makeStore } from "./store/db";

export interface AppOpts {
  db: Database;
  dataDir: string;
  auth?: { user: string; pass: string };
  llm?: LlmClient;
}

export function createApp(opts: AppOpts): Hono {
  const app = new Hono();
  if (opts.auth) app.use("*", basicAuth(opts.auth.user, opts.auth.pass));
  app.get("/api/health", (c) => c.json({ ok: true }));
  const store = makeStore(initSchema(opts.db));
  const llm: LlmClient =
    opts.llm ?? { complete: async () => { throw new Error("LLM not configured"); } };
  mountApi(app, { store, dataDir: opts.dataDir, llm });
  return app;
}
