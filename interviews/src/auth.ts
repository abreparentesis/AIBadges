import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // length check first; timingSafeEqual throws on unequal lengths
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function basicAuth(user: string, pass: string): MiddlewareHandler {
  return async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    if (h.startsWith("Basic ")) {
      const decoded = Buffer.from(h.slice(6), "base64").toString();
      const sep = decoded.indexOf(":");
      const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const p = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (safeEq(u, user) && safeEq(p, pass)) return next();
    }
    return c.body("Unauthorized", 401, {
      "WWW-Authenticate": 'Basic realm="interviews"',
    });
  };
}
