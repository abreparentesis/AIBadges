import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Database } from 'bun:sqlite';
import { ProfileSchema, SignalInputSchema } from './types';
import { renderBadgeSvg, svgToPng, loadFallbackPng, type StatBadgeContent } from './og';

const PROVENANCE_LABEL = 'Self-computed in your own AI session. Not verified by us.';

function bearer(authHeader: string | undefined): string | null {
  const m = (authHeader ?? '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
const nowIso = () => new Date().toISOString();
const newToken = () => crypto.randomUUID().replace(/-/g, '');

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export function renderCardBody(type: string, content: Record<string, unknown>): string {
  if (type === 'identityCard') {
    const traits = Array.isArray(content.traits) ? content.traits : [];
    return `<h1>${esc(content.headline ?? 'Profile')}</h1><ul>${traits.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }
  if (type === 'statBadge') {
    const f = (content.aiFluency ?? {}) as Record<string, unknown>;
    const headline = content.fluencyScore !== undefined
      ? `${esc(content.fluencyScore)}/100${content.level ? ` &#183; ${esc(content.level)}` : ''}`
      : `Stage ${esc(content.yeggeStage ?? '?')}`;
    return `<div class="brand">Capability</div><p class="big">${headline}</p>` +
      `<ul>${Object.entries(f).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>`;
  }
  if (type === 'trajectorySnippet') {
    const shifts = Array.isArray(content.shifts) ? (content.shifts as Array<Record<string, unknown>>) : [];
    return `<div class="brand">Trajectory</div><ul>${shifts.map((s) => `<li>${esc(s.dimension)}: ${esc(s.direction)} <span class="muted">(${esc(s.velocity)})</span></li>`).join('')}</ul>`;
  }
  if (type === 'typeCard') {
    const groupColor: Record<string, string> = { Analysts: '#5737f4', Diplomats: '#12b76a', Sentinels: '#0046ff', Explorers: '#f5a623' };
    const col = typeof content.color === 'string' ? content.color : (groupColor[String(content.group)] ?? '#5737f4');
    const axes = (content.axes ?? {}) as Record<string, { letter?: string; lean?: number }>;
    const WORD: Record<string, string> = { E: 'Extraversion', I: 'Introversion', S: 'Sensing', N: 'iNtuition', T: 'Thinking', F: 'Feeling', J: 'Judging', P: 'Perceiving' };
    const bars = ['EI', 'SN', 'TF', 'JP'].map((k) => {
      const a = axes[k] ?? {}; const lean = Math.max(0, Math.min(100, Number(a.lean) || 50));
      return `<div class="ax"><div class="axl"><span>${esc(WORD[String(a.letter)] ?? a.letter ?? '')}</span><b>${lean}</b></div><div class="bar"><i style="width:${lean}%"></i></div></div>`;
    }).join('');
    return `<div class="holo" style="--col:${esc(col)}">
      <div class="htop"><span>● AI FLUENCY INDEX</span><span class="rar">${esc(String(content.group ?? '').replace(/s$/, '').toUpperCase())}</span></div>
      <div class="hcode">${esc(content.code ?? '?')}</div>
      <div class="hname">${esc(content.name ?? '')}</div>
      <div class="hgrp">${esc(content.group ?? '')}</div>
      <div class="hsum">${esc(content.summary ?? '')}</div>
      <div class="axes">${bars}</div>
      <div class="hdis">Public-domain Jungian dichotomies (E/I, S/N, T/F, J/P). Not affiliated with or derived from the Myers-Briggs Type Indicator® or The Myers-Briggs Company.</div>
    </div>`;
  }
  return `<h1>${esc(type)}</h1><pre>${esc(JSON.stringify(content, null, 2))}</pre>`;
}

const EXTENSION_URL = 'https://github.com/abreparentesis/AIBadges'; // swap for the Chrome Web Store listing once published

const DIMENSIONS: Array<{ key: string; name: string; blurb: string }> = [
  { key: 'delegation', name: 'Delegation', blurb: 'What they hand off to AI, and how completely they scope it.' },
  { key: 'description', name: 'Description', blurb: 'How clearly they state goals, constraints, and context.' },
  { key: 'discernment', name: 'Discernment', blurb: 'Whether they judge and push back on the AI\'s output.' },
  { key: 'diligence', name: 'Diligence', blurb: 'Whether they verify what the AI produces before relying on it.' },
];
const BAND_TICKS_PAGE: Record<string, number> = { emerging: 1, developing: 2, proficient: 3, advanced: 4 };

function fmtDate(iso: unknown): string {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtMonth(iso: unknown): string {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// The public share page is the web edition of the OG certificate: same engraved-institution
// language (Besley display, ink/purple/hairline palette) so the click-through from a
// LinkedIn card lands in the same visual world. Personality sections are gone with the
// fluency-only pivot; the page renders the credential, explains the four dimensions,
// says when it was measured, and nudges the viewer to measure themselves.
function renderReportPage(
  signals: Array<{ type: string; surfacedContent: Record<string, unknown> }>,
  provenance: string,
  ogImageUrl?: string,
  coverage?: { provisional: boolean; conversationCount: number },
  meta?: { computedAt?: string; sourceWindow?: { fromDate?: string; toDate?: string; conversationCount?: number } },
): string {
  const statC = signals.find((s) => s.type === 'statBadge')?.surfacedContent;

  const score = statC?.fluencyScore;
  const level = typeof statC?.level === 'string' ? statC.level : '';
  const source = typeof statC?.source === 'string' ? statC.source : ''; // "Claude" | "ChatGPT"
  const headline = statC
    ? (score !== undefined ? `${esc(score)}/100` : `Stage ${esc(statC.yeggeStage ?? '?')}`)
    : '';

  const og = statC
    ? `<meta property="og:title" content="AI Fluency Index${source ? ` · ${esc(source)}` : ''} — ${esc(headline)}${level ? ` (${esc(level)})` : ''}">
<meta property="og:description" content="Assessed from real ${source ? `${esc(source)} ` : ''}chat history across four fluency dimensions. Every claim anchored to evidence.">
<meta property="og:site_name" content="AI Fluency Index">`
    : '<meta property="og:title" content="AI Fluency Index profile">';
  const ogImage = ogImageUrl
    ? `<meta property="og:image" content="${esc(ogImageUrl)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="627">
<meta name="twitter:card" content="summary_large_image">`
    : '<meta name="twitter:card" content="summary">';

  // Measured line: date + window, only from what the profile actually recorded.
  const sw = meta?.sourceWindow;
  const measuredBits: string[] = [];
  if (meta?.computedAt && fmtDate(meta.computedAt)) measuredBits.push(`Measured ${fmtDate(meta.computedAt)}`);
  if (sw?.conversationCount) {
    const span = fmtMonth(sw.fromDate) && fmtMonth(sw.toDate) ? ` spanning ${fmtMonth(sw.fromDate)} – ${fmtMonth(sw.toDate)}` : '';
    measuredBits.push(`from ${Number(sw.conversationCount)} ${source ? `${source} ` : ''}conversations${span}`);
  } else if (source) {
    measuredBits.push(`from their ${source} history`);
  }
  const measured = measuredBits.join(' ');

  const f = (statC?.aiFluency ?? {}) as Record<string, unknown>;
  const dimensionRows = DIMENSIONS.filter((d) => typeof f[d.key] === 'string').map((d) => {
    const band = String(f[d.key]);
    const ticks = BAND_TICKS_PAGE[band] ?? 2;
    const segs = [0, 1, 2, 3].map((n) => `<i class="${n < ticks ? 'on' : ''}"></i>`).join('');
    return `<div class="dim">
      <div class="dimhead"><span class="dimname">${esc(d.name)}</span><span class="scale" aria-hidden="true">${segs}</span><span class="band">${esc(band)}</span></div>
      <p class="dimblurb">${esc(d.blurb)}</p>
    </div>`;
  }).join('');

  const certificate = statC
    ? `<section class="cert" aria-label="AI Fluency Index credential">
      <div class="eyebrow">&#9679; AI FLUENCY INDEX</div>
      <div class="kicker">Credential</div>
      <div class="score">${headline}</div>
      ${level ? `<div class="level">${esc(level)}</div>` : ''}
      ${measured ? `<div class="measured">${esc(measured)}</div>` : ''}
      ${coverage?.provisional ? `<div class="prov"><strong>Provisional read.</strong> Computed from only ${Number(coverage.conversationCount)} conversation${coverage.conversationCount === 1 ? '' : 's'} of chat history; levels read low on thin history. A fuller import gives a more reliable picture.</div>` : ''}
      <div class="rule"></div>
      <div class="dims">${dimensionRows}</div>
      <div class="rule"></div>
      <p class="provenance">${esc(provenance)} Every claim is anchored to real quotes from the holder's own history.</p>
    </section>`
    : `<section class="cert empty">
      <div class="eyebrow">&#9679; AI FLUENCY INDEX</div>
      <p class="nobadge">This person hasn't published their AI Fluency Index yet.</p>
    </section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Fluency Index${headline ? ` — ${headline}` : ''}</title>
${og}
${ogImage}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Besley:wght@700;800&display=swap" rel="stylesheet">
<style>
:root{--ink:#17103B;--purple:#5737F4;--muted:#5D5876;--hair:#D9D3EE;--ground:#FBFAFD;--amber-bg:#FFF2D6;--amber-ink:#7A4A12}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--ground);color:var(--ink)}
.topbar{height:60px;display:flex;align-items:center;padding:0 28px;border-bottom:1px solid var(--hair)}
.topbar .mark{font-weight:700;letter-spacing:-.01em}
main{max-width:840px;margin:0 auto;padding:48px 24px 72px}
.cert{background:#fff;border:2px solid var(--ink);position:relative;padding:56px 48px 40px;text-align:center;
  box-shadow:0 24px 60px rgba(23,16,59,.08)}
.cert::after{content:"";position:absolute;inset:10px;border:.75px solid var(--purple);pointer-events:none}
.eyebrow{font-size:13px;font-weight:700;letter-spacing:.42em;text-indent:.42em}
.kicker{margin-top:34px;font-size:13px;letter-spacing:.34em;text-indent:.34em;text-transform:uppercase;color:var(--purple)}
.score{font-family:Besley,Georgia,serif;font-weight:800;font-size:clamp(56px,9vw,84px);line-height:1.05;margin-top:14px;letter-spacing:-.01em}
.level{font-family:Besley,Georgia,serif;font-weight:700;font-size:clamp(22px,3.4vw,28px);margin-top:2px;color:var(--purple)}
.measured{margin-top:14px;font-size:14px;color:var(--muted)}
.prov{margin:22px auto 0;max-width:560px;background:var(--amber-bg);color:var(--amber-ink);padding:12px 18px;font-size:13.5px;line-height:1.5;text-align:left}
.rule{height:1px;background:var(--hair);margin:34px auto;max-width:560px}
.dims{max-width:600px;margin:0 auto;text-align:left;display:grid;gap:22px}
.dimhead{display:flex;align-items:baseline;gap:14px}
.dimname{font-weight:650;font-size:16px;flex:0 0 118px}
.scale{display:inline-flex;gap:5px;flex:1}
.scale i{width:30px;height:5px;border-radius:2.5px;background:var(--hair)}
.scale i.on{background:var(--purple)}
.band{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.dimblurb{margin:4px 0 0 132px;font-size:13.5px;color:var(--muted);line-height:1.5}
.provenance{max-width:560px;margin:0 auto;font-size:12.5px;color:var(--muted);line-height:1.6}
.nobadge{font-family:Besley,Georgia,serif;font-size:22px;margin:40px 0}
.cta{margin-top:36px;text-align:center}
.cta h2{font-family:Besley,Georgia,serif;font-size:24px;font-weight:700;margin:0 0 6px}
.cta p{margin:0 auto;max-width:480px;font-size:14.5px;color:var(--muted)}
.cta a{display:inline-block;margin-top:16px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;
  font-size:15px;padding:12px 26px;border-radius:8px}
.cta a:hover{background:var(--purple)}
@media (max-width:600px){.cert{padding:40px 20px 32px}.dimname{flex-basis:100%}.dimblurb{margin-left:0}.dimhead{flex-wrap:wrap}}
@media (prefers-reduced-motion:no-preference){.cta a{transition:background .18s ease-out}}
</style></head>
<body>
<div class="topbar"><span class="mark">AI Fluency Index</span></div>
<main>
${certificate}
<section class="cta">
  <h2>How fluently do you work with AI?</h2>
  <p>This index is computed from the holder's own chat history, in their own AI session — raw conversations never leave their machine. Measure yours the same way.</p>
  <a href="${EXTENSION_URL}" rel="noopener">Get the Chrome extension &rarr;</a>
</section>
</main>
</body></html>`;
}

export function createApp(db: Database, opts: { inviteToken: string; ogRender?: (content: StatBadgeContent) => Buffer }) {
  const app = new Hono();

  // Register a brand-new user key if needed, returning whether the request may proceed.
  // When an invite token is configured, a new key must present the matching X-AIBadges-Invite
  // header. When it is empty, registration is permissionless: any new key is accepted.
  const registerIfNeeded = (key: string, inviteHeader: string | undefined): boolean => {
    if (db.query('SELECT 1 FROM users WHERE user_key = ?').get(key)) return true;
    if (opts.inviteToken && inviteHeader !== opts.inviteToken) return false;
    db.query('INSERT INTO users (user_key, created_at) VALUES (?, ?)').run(key, nowIso());
    return true;
  };

  // Content-script fetches (from the claude.ai origin) are subject to CORS in MV3. Allow the
  // API routes cross-origin with our custom headers. No cookies are used (bearer only).
  app.use('/v1/*', cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization', 'X-AIBadges-Invite'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }));

  app.get('/health', (c) => c.json({ ok: true }));

  // POST /v1/profile — store a new profile version (registers the user on first push).
  app.post('/v1/profile', async (c) => {
    const key = bearer(c.req.header('Authorization'));
    if (!key) return c.json({ error: 'missing bearer key' }, 401);

    if (!registerIfNeeded(key, c.req.header('X-AIBadges-Invite'))) {
      return c.json({ error: 'valid invite required to register' }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = ProfileSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid profile', issues: parsed.error.issues }, 400);

    const row = db.query('SELECT MAX(version) AS v FROM profile_versions WHERE user_key = ?').get(key) as { v: number | null };
    const version = (row?.v ?? 0) + 1;
    const profile = { ...parsed.data, version };
    db.query('INSERT INTO profile_versions (user_key, version, profile_json, created_at) VALUES (?, ?, ?, ?)')
      .run(key, version, JSON.stringify(profile), nowIso());
    return c.json({ version }, 201);
  });

  // DELETE /v1/profile — erase everything held for this key: profile versions, signals
  // (which kills any share links), and the user row itself. Idempotent: deleting a key
  // we have never seen still succeeds, so the client can offer it unconditionally.
  const eraseUser = db.transaction((key: string) => {
    // Children first: signals and profile_versions reference users(user_key).
    db.query('DELETE FROM signals WHERE user_key = ?').run(key);
    db.query('DELETE FROM profile_versions WHERE user_key = ?').run(key);
    db.query('DELETE FROM users WHERE user_key = ?').run(key);
  });
  app.delete('/v1/profile', (c) => {
    const key = bearer(c.req.header('Authorization'));
    if (!key) return c.json({ error: 'missing bearer key' }, 401);
    eraseUser(key);
    return c.json({ deleted: true });
  });

  // GET /v1/profile — latest profile + the user's current signals.
  app.get('/v1/profile', (c) => {
    const key = bearer(c.req.header('Authorization'));
    if (!key) return c.json({ error: 'missing bearer key' }, 401);
    const prof = db.query('SELECT profile_json FROM profile_versions WHERE user_key = ? ORDER BY version DESC LIMIT 1')
      .get(key) as { profile_json: string } | null;
    if (!prof) return c.json({ error: 'no profile yet' }, 404);
    const sigs = db.query('SELECT type, surfaced_json, disclosure, share_token, from_version FROM signals WHERE user_key = ?')
      .all(key) as Array<{ type: string; surfaced_json: string; disclosure: string; share_token: string | null; from_version: number }>;
    return c.json({
      profile: JSON.parse(prof.profile_json),
      signals: sigs.map((s) => ({
        type: s.type, surfacedContent: JSON.parse(s.surfaced_json),
        disclosure: s.disclosure, shareToken: s.share_token, fromVersion: s.from_version,
      })),
    });
  });

  // POST /v1/signals — upsert signals; mint/keep/clear share tokens by disclosure.
  app.post('/v1/signals', async (c) => {
    const key = bearer(c.req.header('Authorization'));
    if (!key) return c.json({ error: 'missing bearer key' }, 401);
    // Register on first call, so sharing works even before a profile push.
    if (!registerIfNeeded(key, c.req.header('X-AIBadges-Invite'))) {
      return c.json({ error: 'valid invite required to register' }, 401);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = SignalInputSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid signals', issues: parsed.error.issues }, 400);

    const out: Array<{ type: string; disclosure: string; shareToken: string | null }> = [];
    for (const s of parsed.data) {
      const existing = db.query('SELECT share_token FROM signals WHERE user_key = ? AND type = ?')
        .get(key, s.type) as { share_token: string | null } | null;
      let token = existing?.share_token ?? null;
      if (s.disclosure === 'private') token = null;
      else if (!token) token = newToken();
      db.query(`INSERT INTO signals (user_key, type, surfaced_json, disclosure, share_token, from_version, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_key, type) DO UPDATE SET
                  surfaced_json = excluded.surfaced_json, disclosure = excluded.disclosure,
                  share_token = excluded.share_token, from_version = excluded.from_version,
                  updated_at = excluded.updated_at`)
        .run(key, s.type, JSON.stringify(s.surfacedContent), s.disclosure, token, s.fromVersion ?? 0, nowIso());
      out.push({ type: s.type, disclosure: s.disclosure, shareToken: token });
    }
    return c.json({ signals: out });
  });

  // GET /v1/share/:token — public read of a shared signal.
  app.get('/v1/share/:token', (c) => {
    const row = db.query('SELECT type, surfaced_json, disclosure FROM signals WHERE share_token = ?')
      .get(c.req.param('token')) as { type: string; surfaced_json: string; disclosure: string } | null;
    if (!row || row.disclosure === 'private') return c.json({ error: 'not found' }, 404);
    return c.json({ type: row.type, surfacedContent: JSON.parse(row.surfaced_json), provenanceLabel: PROVENANCE_LABEL });
  });

  // GET /og/:token.png — the LinkedIn og:image. Renders the token owner's PUBLIC statBadge.
  // Same policy as /s/:token: unknown or private is a plain 404 (no existence oracle).
  const ogRender = opts.ogRender ?? ((c: StatBadgeContent) => svgToPng(renderBadgeSvg(c)));
  app.get('/og/:token{.+\\.png}', (c) => {
    const token = c.req.param('token').replace(/\.png$/, '');
    const owner = db.query("SELECT user_key FROM signals WHERE share_token = ? AND disclosure = 'public'")
      .get(token) as { user_key: string } | null;
    if (!owner) return c.json({ error: 'not found' }, 404);
    const stat = db.query("SELECT surfaced_json FROM signals WHERE user_key = ? AND type = 'statBadge' AND disclosure = 'public'")
      .get(owner.user_key) as { surfaced_json: string } | null;
    if (!stat) return c.json({ error: 'not found' }, 404);
    let png: Buffer;
    try {
      png = ogRender(JSON.parse(stat.surfaced_json) as StatBadgeContent);
    } catch (e) {
      console.error('[og] render failed, serving fallback:', e);
      png = loadFallbackPng();
    }
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' });
  });

  // GET /s/:token — public, human-readable full report showing the owner's PUBLIC sections only.
  // Any public section's token resolves to the same report (they all link to one page).
  app.get('/s/:token', (c) => {
    const owner = db.query("SELECT user_key FROM signals WHERE share_token = ? AND disclosure = 'public'")
      .get(c.req.param('token')) as { user_key: string } | null;
    if (!owner) {
      return c.html('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui;background:#0b0d12;color:#e6e8ee">This profile link is not available.</body>', 404);
    }
    const pubs = db.query("SELECT type, surfaced_json FROM signals WHERE user_key = ? AND disclosure = 'public'")
      .all(owner.user_key) as Array<{ type: string; surfaced_json: string }>;
    const url = new URL(c.req.url);
    const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const ogImageUrl = `${proto}://${url.host}/og/${c.req.param('token')}.png`;
    // The thin-history caveat travels with the shared page: a provisional profile must
    // not read as a confident verdict to a recruiter clicking the badge.
    const prof = db.query('SELECT profile_json FROM profile_versions WHERE user_key = ? ORDER BY version DESC LIMIT 1')
      .get(owner.user_key) as { profile_json: string } | null;
    let coverage: { provisional: boolean; conversationCount: number } | undefined;
    let meta: { computedAt?: string; sourceWindow?: { fromDate?: string; toDate?: string; conversationCount?: number } } | undefined;
    if (prof) {
      try {
        const parsed = JSON.parse(prof.profile_json) as {
          computedAt?: unknown;
          sourceWindow?: { fromDate?: unknown; toDate?: unknown; conversationCount?: unknown };
          coverage?: { provisional?: unknown; conversationCount?: unknown };
        };
        if (parsed.coverage && typeof parsed.coverage.provisional === 'boolean' && typeof parsed.coverage.conversationCount === 'number') {
          coverage = { provisional: parsed.coverage.provisional, conversationCount: parsed.coverage.conversationCount };
        }
        meta = {
          computedAt: typeof parsed.computedAt === 'string' ? parsed.computedAt : undefined,
          sourceWindow: parsed.sourceWindow ? {
            fromDate: typeof parsed.sourceWindow.fromDate === 'string' ? parsed.sourceWindow.fromDate : undefined,
            toDate: typeof parsed.sourceWindow.toDate === 'string' ? parsed.sourceWindow.toDate : undefined,
            conversationCount: typeof parsed.sourceWindow.conversationCount === 'number' ? parsed.sourceWindow.conversationCount : undefined,
          } : undefined,
        };
      } catch { /* stored JSON is trusted but stay defensive; no banner beats a 500 */ }
    }
    return c.html(renderReportPage(
      pubs.map((s) => ({ type: s.type, surfacedContent: JSON.parse(s.surfaced_json) as Record<string, unknown> })),
      PROVENANCE_LABEL,
      ogImageUrl,
      coverage,
      meta,
    ));
  });

  return app;
}
