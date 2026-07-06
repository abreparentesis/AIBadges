import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { join, resolve } from "node:path";
import { basicAuth } from "./auth";
import { mountApi } from "./api/routes";
import type { LlmClient } from "./llm/client";
import { initSchema, makeStore } from "./store/db";

export interface AppOpts {
  db: Database;
  dataDir: string;
  auth?: { user: string; pass: string };
  llm?: LlmClient;
  uiDir?: string;
}

export function createApp(opts: AppOpts): Hono {
  const app = new Hono();
  if (opts.auth) app.use("*", basicAuth(opts.auth.user, opts.auth.pass));
  app.get("/api/health", (c) => c.json({ ok: true }));
  const store = makeStore(initSchema(opts.db));
  const llm: LlmClient =
    opts.llm ?? { complete: async () => { throw new Error("LLM not configured"); } };
  mountApi(app, { store, dataDir: opts.dataDir, llm });

  if (opts.uiDir) {
    const uiRoot = resolve(opts.uiDir);
    app.get("*", async (c) => {
      const { pathname } = new URL(c.req.url);
      if (pathname.startsWith("/api/")) return c.notFound();
      const wanted = resolve(uiRoot, "." + pathname);
      if (wanted.startsWith(uiRoot)) {
        const file = Bun.file(wanted === uiRoot ? join(uiRoot, "index.html") : wanted);
        if (await file.exists()) return new Response(file);
      }
      // SPA fallback
      const index = Bun.file(join(uiRoot, "index.html"));
      if (await index.exists()) {
        return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return c.notFound();
    });
  }
  return app;
}
