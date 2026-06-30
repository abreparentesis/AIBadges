import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Database } from 'bun:sqlite';
import { ProfileSchema, SignalInputSchema } from './types';

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
    return `<div class="brand">Capability</div><p class="big">Stage ${esc(content.yeggeStage ?? '?')}</p>` +
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
      <div class="htop"><span>● AIBADGES</span><span class="rar">${esc(String(content.group ?? '').replace(/s$/, '').toUpperCase())}</span></div>
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

// Full LIGHT-themed public report mirroring the client UI: shows only the sections the
// owner marked public. typeCard -> collectible hero + summary; identityCard -> "How you
// think" trait cards; trajectorySnippet -> "Where you're heading" momentum rows.
function renderReportPage(
  signals: Array<{ type: string; surfacedContent: Record<string, unknown> }>,
  provenance: string,
): string {
  const byType = (t: string) => signals.find((s) => s.type === t)?.surfacedContent;
  const typeC = byType('typeCard');
  const identityC = byType('identityCard');
  const trajC = byType('trajectorySnippet');

  const og = typeC
    ? `<meta property="og:title" content="I'm ${esc(typeC.code ?? '')} — ${esc(typeC.name ?? '')}">
<meta property="og:description" content="${esc(typeC.summary ?? 'My cognitive profile, computed from my own AI chats.')}">
<meta name="twitter:card" content="summary"><meta property="og:site_name" content="AIBadges">`
    : `<meta property="og:title" content="AIBadges profile">`;

  // Cognitive Type hero (reuse the collectible card body) + summary.
  let typeSection = '';
  if (typeC) {
    typeSection = `<section class="sec">
      <div class="sech"><span class="dot" style="background:#5737f4"></span><h2>Cognitive Type</h2></div>
      <div class="hero">
        <div class="herocard">${renderCardBody('typeCard', typeC)}</div>
        <div class="herosum">${esc(typeC.summary ?? '')}</div>
      </div>
    </section>`;
  }

  // How you think — one trait card per thinking claim, cycling an accent color.
  let thinkingSection = '';
  if (identityC) {
    const thinking = Array.isArray(identityC.thinking)
      ? (identityC.thinking as Array<Record<string, unknown>>) : [];
    const cards = thinking.map((tItem, i) => {
      const conf = String(tItem.confidence ?? 'low');
      const confClass = ['high', 'medium', 'low'].includes(conf) ? conf : 'low';
      return `<div class="trait c${i % 6}">
        <div class="tt">${esc(tItem.claim ?? '')}</div>
        <span class="conf ${confClass}">${esc(conf)} confidence</span>
      </div>`;
    }).join('');
    thinkingSection = `<section class="sec">
      <div class="sech"><span class="dot" style="background:#5737f4"></span><h2>How you think</h2></div>
      <div class="grid2">${cards}</div>
    </section>`;
  }

  // Where you're heading — one momentum row per trajectory shift.
  let trajSection = '';
  if (trajC) {
    const shifts = Array.isArray(trajC.shifts)
      ? (trajC.shifts as Array<Record<string, unknown>>) : [];
    const ARROW: Record<string, string> = { rising: '↑', falling: '↓', steady: '→' };
    const rows = shifts.map((s) => {
      const dir = String(s.direction ?? 'steady');
      const dirClass = ['rising', 'falling', 'steady'].includes(dir) ? dir : 'steady';
      return `<div class="mrow">
        <span class="arr ${dirClass}">${esc(ARROW[dir] ?? ARROW.steady)}</span>
        <span class="dim">${esc(s.dimension ?? '')}</span>
        <span class="vel">${esc(dir)} · ${esc(s.velocity ?? '')}</span>
      </div>`;
    }).join('');
    trajSection = `<section class="sec">
      <div class="sech"><span class="dot" style="background:#12b76a"></span><h2>Where you're heading</h2></div>
      ${rows}
    </section>`;
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AIBadges profile</title>
${og}
<style>
:root{
  --blue:#0046ff;--purple:#5737f4;--mint:#3effc8;--lime:#c4ff3c;--pink:#ff5983;--amber:#f5a623;
  --success:#12b76a;--success-bg:#c9ffeb;--success-text:#005c4c;
  --g50:#f9fafb;--g100:#f3f4f6;--g200:#e5e7eb;--g300:#d2d6db;--g500:#6c737f;--g600:#4d5761;--g700:#384250;--g900:#111927;
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font:16px/1.55 system-ui,-apple-system,sans-serif;background:#fff;color:var(--g900)}
.topbar{border-bottom:1px solid var(--g200);height:60px;display:flex;align-items:center;padding:0 24px}
.topbar .mark{font-weight:700;letter-spacing:-.01em}
.topbar .sub{margin-left:12px;padding-left:12px;border-left:1px solid var(--g200);color:var(--g600);font-size:14px}
main{max-width:760px;margin:0 auto;padding:34px 24px 60px}
.sec{margin-top:38px}
.sec:first-of-type{margin-top:24px}
.sech{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.sech h2{font-size:21px;font-weight:600;margin:0}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.hero{display:flex;gap:28px;align-items:center;flex-wrap:wrap}
.herocard{flex:0 0 auto}
.herosum{flex:1;min-width:260px;font-size:18px;line-height:1.55;color:var(--g700)}
/* Collectible hero card (ported from theme.css .holo, dark gradient on a white page) */
.holo{--col:#5737f4;width:330px;border-radius:22px;overflow:hidden;position:relative;color:#fff;
  background:linear-gradient(160deg,color-mix(in srgb,var(--col) 70%,#fff 0%),var(--col) 55%,#1b0e8c);
  padding:24px 22px;display:flex;flex-direction:column;box-shadow:0 18px 44px rgba(44,18,244,.30)}
.holo::before{content:"";position:absolute;inset:0;background:
  radial-gradient(120px 120px at 82% 10%,rgba(196,255,60,.34),transparent 60%),
  radial-gradient(150px 150px at 12% 92%,rgba(62,255,200,.30),transparent 60%),
  repeating-linear-gradient(115deg,rgba(255,255,255,.10) 0 2px,transparent 2px 9px);mix-blend-mode:screen}
.holo>*{position:relative}
.htop{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.88}
.rar{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);padding:3px 10px;border-radius:50px;font-weight:600}
.hcode{font-size:72px;font-weight:800;line-height:1;margin-top:22px;letter-spacing:-.02em}
.hname{font-size:24px;font-weight:600;margin-top:2px}
.hgrp{display:inline-block;margin-top:11px;background:rgba(255,255,255,.14);padding:5px 12px;border-radius:50px;font-size:13px;width:fit-content}
.hsum{margin:16px 0 18px;font-size:14px;opacity:.95}
.axes{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.ax .axl{display:flex;justify-content:space-between;font-size:12px;opacity:.92;margin-bottom:4px}
.ax .bar{height:7px;border-radius:50px;background:rgba(255,255,255,.22);overflow:hidden}
.ax .bar>i{display:block;height:100%;border-radius:50px;background:linear-gradient(90deg,var(--mint),var(--lime))}
.hdis{margin-top:18px;font-size:10px;opacity:.7;line-height:1.4}
/* Trait cards (ported from theme.css .trait/.conf) */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.trait{background:#fff;border:1px solid var(--g200);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden}
.trait::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px}
.trait.c0::before{background:var(--purple)}.trait.c1::before{background:var(--mint)}.trait.c2::before{background:var(--pink)}
.trait.c3::before{background:var(--blue)}.trait.c4::before{background:var(--lime)}.trait.c5::before{background:var(--amber)}
.trait .tt{font-size:15px;line-height:1.5}
.conf{display:inline-block;margin-top:10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:3px 10px;border-radius:50px}
.conf.high{background:var(--success-bg);color:var(--success-text)}.conf.medium{background:#fff2d6;color:#7a4a12}.conf.low{background:var(--g100);color:var(--g600)}
/* Momentum rows (ported from theme.css .mrow/.arr/.vel) */
.mrow{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--g200);border-radius:14px;padding:14px 18px;margin-bottom:12px}
.arr{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;flex:0 0 auto}
.arr.rising{background:var(--success)}.arr.falling{background:var(--pink)}.arr.steady{background:var(--blue)}
.mrow .dim{flex:1;font-size:15px}
.vel{font-size:12px;font-weight:600;color:var(--g600);background:var(--g100);padding:4px 12px;border-radius:50px;text-transform:capitalize;white-space:nowrap}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--g200);font-size:12px;color:var(--g500);text-align:center;line-height:1.5}
@media (max-width:560px){.grid2{grid-template-columns:1fr}}
</style></head>
<body>
<div class="topbar"><span class="mark">AIBadges</span><span class="sub">living profile</span></div>
<main>${typeSection}${thinkingSection}${trajSection}</main>
<footer>${esc(provenance)} Public-domain Jungian dichotomies (E/I, S/N, T/F, J/P). Not affiliated with or derived from the Myers-Briggs Type Indicator® or The Myers-Briggs Company.</footer>
</body></html>`;
}

export function createApp(db: Database, opts: { inviteToken: string }) {
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
    allowMethods: ['GET', 'POST', 'OPTIONS'],
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
    return c.html(renderReportPage(
      pubs.map((s) => ({ type: s.type, surfacedContent: JSON.parse(s.surfaced_json) as Record<string, unknown> })),
      PROVENANCE_LABEL,
    ));
  });

  return app;
}
