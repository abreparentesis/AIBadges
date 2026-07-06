import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../src/server";

const auth = { user: "u", pass: "p" };
const app = createApp({ db: new Database(":memory:"), dataDir: "/tmp", auth });
const header = "Basic " + Buffer.from("u:p").toString("base64");

describe("server auth", () => {
  it("rejects without credentials", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects wrong credentials", async () => {
    const bad = "Basic " + Buffer.from("u:wrong").toString("base64");
    const res = await app.request("/api/health", { headers: { authorization: bad } });
    expect(res.status).toBe(401);
  });

  it("accepts valid credentials", async () => {
    const res = await app.request("/api/health", { headers: { authorization: header } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("open when auth not configured (dev)", async () => {
    const open = createApp({ db: new Database(":memory:"), dataDir: "/tmp" });
    const res = await open.request("/api/health");
    expect(res.status).toBe(200);
  });
});
