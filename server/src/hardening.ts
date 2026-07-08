import type { Context, Next } from 'hono';

/**
 * Production hardening middleware. Everything here is deliberately dependency-free and
 * in-memory: the backend is a single Bun process in front of SQLite, so a per-process
 * sliding-window limiter is both sufficient and honest (no distributed state to lie about).
 */

export interface RateLimitOpts {
  windowMs: number;
  max: number;
  /** Identity to rate-limit on. Defaults to bearer key, else first X-Forwarded-For hop, else 'anon'. */
  keyOf?: (c: Context) => string;
}

export function clientId(c: Context): string {
  const auth = (c.req.header('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (auth) return `k:${auth[1].trim()}`;
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return `ip:${fwd.split(',')[0].trim()}`;
  return 'anon';
}

// One Map per limiter instance. Bounded: if an abuser floods with unique identities the map
// is cleared rather than growing without limit — a momentary amnesty is cheaper than OOM.
const MAX_TRACKED = 50_000;

export function rateLimiter(opts: RateLimitOpts) {
  const hits = new Map<string, number[]>();
  const keyOf = opts.keyOf ?? clientId;
  return async (c: Context, next: Next) => {
    const now = Date.now();
    const key = keyOf(c);
    if (hits.size > MAX_TRACKED) hits.clear();
    const windowStart = now - opts.windowMs;
    const prev = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (prev.length >= opts.max) {
      hits.set(key, prev);
      return c.json({ error: 'rate limited — try again shortly' }, 429);
    }
    prev.push(now);
    hits.set(key, prev);
    await next();
  };
}

/** nosniff everywhere; CSP + referrer policy on the public HTML pages (no scripts are served). */
export async function securityHeaders(c: Context, next: Next) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/s/')) {
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', [
      "default-src 'none'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '));
  }
}
