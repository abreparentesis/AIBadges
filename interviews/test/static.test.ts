import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server";

describe("static SPA serving", () => {
  const uiDir = mkdtempSync(join(tmpdir(), "ui-dist-"));
  writeFileSync(join(uiDir, "index.html"), "<html>SPA</html>");
  const app = createApp({
    db: new Database(":memory:"),
    dataDir: mkdtempSync(join(tmpdir(), "data-")),
    uiDir,
  });

  it("serves index at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA");
  });

  it("SPA fallback for client routes", async () => {
    const res = await app.request("/anything/deep");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA");
  });

  it("api routes not swallowed", async () => {
    const res = await app.request("/api/health");
    expect((await res.json()) as any).toEqual({ ok: true });
    expect((await app.request("/api/nope")).status).toBe(404);
  });

  it("path traversal blocked", async () => {
    const res = await app.request("/..%2f..%2fetc%2fpasswd");
    const text = await res.text();
    expect(text).toContain("SPA"); // falls back to index, never escapes uiDir
  });
});
