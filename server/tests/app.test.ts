import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createApp, renderCardBody } from '../src/app';
import { migrate } from '../src/db';

const INVITE = 'test-invite-token';

function makeApp() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;'); // match production (createDb); guards DELETE ordering
  migrate(db);
  return createApp(db, { inviteToken: INVITE });
}

// Permissionless server: no invite token configured, any new key may register.
function makeOpenApp() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return createApp(db, { inviteToken: '' });
}

type App = ReturnType<typeof createApp>;
function call(app: App, method: string, path: string, o: { key?: string; invite?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.key) headers['Authorization'] = `Bearer ${o.key}`;
  if (o.invite) headers['X-AIBadges-Invite'] = o.invite;
  return app.request(path, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}

const sampleProfile = {
  version: 99, // server should ignore + reassign
  computedAt: '2026-06-05T00:00:00Z',
  modelProvenance: 'claude-in-session',
  sourceWindow: { fromDate: '2026-01-01T00:00:00Z', toDate: '2026-06-01T00:00:00Z', conversationCount: 3 },
  thinking: [{ claim: 'Decomposes before acting', evidenceIds: ['c1:0'], confidence: 'high' }],
  capability: {
    aiFluency: {
      delegation: { band: 'proficient', evidenceIds: [] }, description: { band: 'advanced', evidenceIds: [] },
      discernment: { band: 'developing', evidenceIds: [] }, diligence: { band: 'proficient', evidenceIds: [] },
    },
    yeggeStage: { stage: 4, evidenceIds: [] },
    domains: [{ name: 'backend', band: 'advanced', evidenceIds: [] }],
  },
  trajectory: { window: { earlyTo: '2026-02-01T00:00:00Z', recentFrom: '2026-05-01T00:00:00Z' }, shifts: [] },
};

describe('health', () => {
  it('returns ok', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('CORS', () => {
  it('answers preflight on /v1 routes with an allow-origin header', async () => {
    const res = await makeApp().request('/v1/profile', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,x-aibadges-invite' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});

describe('invite gate (when configured)', () => {
  it('rejects a new key without an invite', async () => {
    const res = await call(makeApp(), 'POST', '/v1/profile', { key: 'k1', body: sampleProfile });
    expect(res.status).toBe(401);
  });
  it('accepts a new key with the correct invite', async () => {
    const res = await call(makeApp(), 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 1 });
  });
});

describe('permissionless registration (no invite configured)', () => {
  it('accepts a brand-new key with no invite header on /v1/profile', async () => {
    const res = await call(makeOpenApp(), 'POST', '/v1/profile', { key: 'anyone', body: sampleProfile });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 1 });
  });
  it('lets a brand-new key share via /v1/signals with no invite header', async () => {
    const res = await call(makeOpenApp(), 'POST', '/v1/signals', {
      key: 'anyone', body: [{ type: 'statBadge', surfacedContent: { yeggeStage: 5 }, disclosure: 'public' }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).signals[0].shareToken).toBeTruthy();
  });
});

describe('profile store', () => {
  it('assigns monotonic versions and ignores client-sent version', async () => {
    const app = makeApp();
    const r1 = await call(app, 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });
    expect(await r1.json()).toEqual({ version: 1 });
    const r2 = await call(app, 'POST', '/v1/profile', { key: 'k1', body: sampleProfile }); // returning user, no invite needed
    expect(r2.status).toBe(201);
    expect(await r2.json()).toEqual({ version: 2 });
    const got = await call(app, 'GET', '/v1/profile', { key: 'k1' });
    expect((await got.json()).profile.version).toBe(2);
  });

  it('rejects an invalid profile body', async () => {
    const res = await call(makeApp(), 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: { nope: true } });
    expect(res.status).toBe(400);
  });

  it('accepts a post-pivot profile with no capability field', async () => {
    const { capability, ...noCap } = sampleProfile; // eslint-disable-line @typescript-eslint/no-unused-vars
    const res = await call(makeApp(), 'POST', '/v1/profile', { key: 'kncap', invite: INVITE, body: noCap });
    expect(res.status).toBe(201);
  });

  it('404s when the user has no profile', async () => {
    const res = await call(makeApp(), 'GET', '/v1/profile', { key: 'nobody' });
    expect(res.status).toBe(404);
  });
});

describe('user isolation', () => {
  it('does not leak one user profile to another key', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'kA', invite: INVITE, body: sampleProfile });
    const res = await call(app, 'GET', '/v1/profile', { key: 'kB' });
    expect(res.status).toBe(404);
  });
});

describe('signals + sharing', () => {
  it('mints a token when public, serves it publicly, and clears it when set private', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });

    const pub = await call(app, 'POST', '/v1/signals', {
      key: 'k1',
      body: [{ type: 'identityCard', surfacedContent: { headline: 'Decomposes before acting' }, disclosure: 'public' }],
    });
    const token = (await pub.json()).signals[0].shareToken as string;
    expect(token).toBeTruthy();

    const shared = await app.request(`/v1/share/${token}`); // public, no auth
    expect(shared.status).toBe(200);
    const sj = await shared.json();
    expect(sj.type).toBe('identityCard');
    expect(sj.surfacedContent.headline).toBe('Decomposes before acting');
    expect(sj.provenanceLabel).toContain('Not verified by us');

    // set private -> token cleared -> public link 404s
    await call(app, 'POST', '/v1/signals', {
      key: 'k1',
      body: [{ type: 'identityCard', surfacedContent: { headline: 'Decomposes before acting' }, disclosure: 'private' }],
    });
    const gone = await app.request(`/v1/share/${token}`);
    expect(gone.status).toBe(404);
  });

  it('surfaces the thin-history caveat on the share page, and only then', async () => {
    const app = makeApp();
    const share = async (key: string, profile: unknown) => {
      await call(app, 'POST', '/v1/profile', { key, invite: INVITE, body: profile });
      const pub = await call(app, 'POST', '/v1/signals', {
        key, body: [{ type: 'statBadge', surfacedContent: { yeggeStage: 3, aiFluency: { delegation: 'developing' } }, disclosure: 'public' }],
      });
      const token = (await pub.json()).signals[0].shareToken as string;
      return (await app.request(`/s/${token}`)).text();
    };

    // provisional coverage -> banner with the conversation count
    const provisional = { ...sampleProfile, coverage: { provisional: true, conversationCount: 5, evidenceConversations: 2 } };
    const withBanner = await share('kprov', provisional);
    expect(withBanner).toContain('Provisional read');
    expect(withBanner).toContain('only 5 conversations');

    // adequate coverage -> no banner
    const adequate = { ...sampleProfile, coverage: { provisional: false, conversationCount: 40, evidenceConversations: 9 } };
    expect(await share('kfull', adequate)).not.toContain('Provisional read');

    // legacy push without coverage -> accepted, no banner
    expect(await share('klegacy', sampleProfile)).not.toContain('Provisional read');
  });

  it('rejects signals from an unknown user without an invite', async () => {
    const res = await call(makeApp(), 'POST', '/v1/signals', { key: 'ghost', body: [] });
    expect(res.status).toBe(401);
  });

  it('self-registers a brand-new key when given a valid invite', async () => {
    const res = await call(makeApp(), 'POST', '/v1/signals', {
      key: 'fresh-key', invite: INVITE,
      body: [{ type: 'statBadge', surfacedContent: { yeggeStage: 5 }, disclosure: 'public' }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).signals[0].shareToken).toBeTruthy();
  });
});

describe('share viewer (HTML)', () => {
  it('renders the fluency certificate for a public badge and 404s an unknown token', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });
    const pub = await call(app, 'POST', '/v1/signals', {
      key: 'k1',
      body: [{ type: 'statBadge', surfacedContent: {
        fluencyScore: 62, level: 'Intermediate', yeggeStage: 4, source: 'ChatGPT',
        aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'emerging' },
      }, disclosure: 'public' }],
    });
    const token = (await pub.json()).signals[0].shareToken as string;

    const page = await app.request(`/s/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('62/100');                 // score consistent with the private view
    expect(html).toContain('Intermediate');            // human level
    expect(html).toContain('Measured');                // when it was measured (from the pushed profile)
    expect(html).toContain('ChatGPT conversations');   // per-provider URLs say which history this is
    expect(html).toContain('hand off to AI');          // dimension explained in plain language
    expect(html).toContain('Get the Chrome extension'); // viewer nudge
    expect(html).not.toContain('living profile');      // retired topbar sub
    expect(html).not.toContain('Jungian');             // personality remnants gone

    const missing = await app.request('/s/does-not-exist');
    expect(missing.status).toBe(404);
  });

  it('renders only the PUBLIC sections, omitting private ones entirely', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });
    const res = await call(app, 'POST', '/v1/signals', {
      key: 'k1',
      body: [
        { type: 'typeCard', disclosure: 'public', surfacedContent: {
          code: 'INTJ', name: 'The Strategist', group: 'Analysts', color: '#5737f4', summary: 'Strategic.',
          axes: { EI: { letter: 'I', lean: 70 }, SN: { letter: 'N', lean: 65 }, TF: { letter: 'T', lean: 80 }, JP: { letter: 'J', lean: 60 } },
        } },
        { type: 'trajectorySnippet', disclosure: 'public', surfacedContent: {
          shifts: [{ dimension: 'verification discipline', direction: 'rising', velocity: 'moderate' }],
        } },
        { type: 'identityCard', disclosure: 'private', surfacedContent: {
          headline: 'SECRET-PRIVATE-CLAIM', thinking: [{ claim: 'SECRET-PRIVATE-CLAIM', confidence: 'high' }],
        } },
      ],
    });
    const sigs = (await res.json()).signals as Array<{ type: string; shareToken: string | null }>;
    const typeToken = sigs.find((s) => s.type === 'typeCard')!.shareToken as string;
    expect(typeToken).toBeTruthy();

    const page = await app.request(`/s/${typeToken}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    // Personality sections are retired with the fluency-only pivot: even PUBLIC typeCard /
    // trajectory content no longer renders, and private content never leaks.
    expect(html).not.toContain('INTJ');
    expect(html).not.toContain('verification discipline');
    expect(html).not.toContain('SECRET-PRIVATE-CLAIM');
    expect(html).toContain("hasn't published their AI Fluency Index"); // graceful fallback
    expect(html).toContain('Get the Chrome extension'); // the nudge survives the fallback
  });
});

describe('AI Fluency Index (statBadge) share render', () => {
  it('renders the Yegge stage and dimension bands when public', async () => {
    const app = makeApp();
    const res = await call(app, 'POST', '/v1/signals', {
      key: 'kal', invite: INVITE,
      body: [{ type: 'statBadge', disclosure: 'public', surfacedContent: {
        yeggeStage: 5,
        aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'proficient' },
      } }],
    });
    const token = (await res.json()).signals[0].shareToken as string;
    expect(token).toBeTruthy();

    const page = await app.request(`/s/${token}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('AI Fluency Index');
    expect(html).toContain('Stage 5');
    expect(html).toContain('proficient');
    expect(html).toContain('advanced');
  });

  it('does not render the AI Fluency Index section when statBadge is private', async () => {
    const app = makeApp();
    const res = await call(app, 'POST', '/v1/signals', {
      key: 'kal2', invite: INVITE,
      body: [
        TC(),
        { type: 'statBadge', disclosure: 'private', surfacedContent: {
          yeggeStage: 5,
          aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'proficient' },
        } },
      ],
    });
    const sigs = (await res.json()).signals as Array<{ type: string; shareToken: string | null }>;
    const typeToken = sigs.find((s) => s.type === 'typeCard')!.shareToken as string;

    const page = await app.request(`/s/${typeToken}`);
    const html = await page.text();
    // The brand string appears in the topbar on every page since the rebrand, so assert on
    // the private section's CONTENT staying absent, not on the brand name.
    expect(html).not.toContain('Stage 5');
    expect(html).not.toContain('Delegation');
  });
});

describe('typeCard share render', () => {
  it('renders the code, name, and a bar per axis', () => {
    const html = renderCardBody('typeCard', {
      code: 'INTJ', name: 'The Strategist', group: 'Analysts', color: '#5737f4', summary: 'Strategic.',
      axes: { EI: { letter: 'I', lean: 70 }, SN: { letter: 'N', lean: 65 }, TF: { letter: 'T', lean: 80 }, JP: { letter: 'J', lean: 60 } },
    });
    expect(html).toContain('INTJ');
    expect(html).toContain('The Strategist');
    expect(html).toContain('70%'); // a stat-bar width
    expect(html).toContain('Myers-Briggs'); // disclaimer present
  });
});

const TC = (over: Record<string, unknown> = {}) => ({
  type: 'typeCard', disclosure: 'public',
  surfacedContent: {
    code: 'INTJ', name: 'The Strategist', group: 'Analysts', color: '#5737f4', summary: 'Strategic.',
    axes: { EI: { letter: 'I', lean: 70 }, SN: { letter: 'N', lean: 65 }, TF: { letter: 'T', lean: 80 }, JP: { letter: 'J', lean: 60 } },
    ...over,
  },
});

describe('making a section private clears its share link', () => {
  it('404s a stale link after public→private', async () => {
    const app = makeApp();
    let res = await call(app, 'POST', '/v1/signals', { key: 'kp', invite: INVITE, body: [TC()] });
    const token = (await res.json()).signals[0].shareToken as string;
    expect(token).toBeTruthy();
    expect((await app.request(`/s/${token}`)).status).toBe(200);
    await call(app, 'POST', '/v1/signals', { key: 'kp', body: [{ ...TC(), disclosure: 'private' }] });
    expect((await app.request(`/s/${token}`)).status).toBe(404);
  });
});

describe('DELETE /v1/profile (account deletion)', () => {
  it('erases the profile, kills share links, and leaves other users intact', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'kdel', invite: INVITE, body: sampleProfile });
    const pub = await call(app, 'POST', '/v1/signals', { key: 'kdel', body: [TC()] });
    const token = (await pub.json()).signals[0].shareToken as string;
    await call(app, 'POST', '/v1/profile', { key: 'kother', invite: INVITE, body: sampleProfile });

    const del = await call(app, 'DELETE', '/v1/profile', { key: 'kdel' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });

    expect((await call(app, 'GET', '/v1/profile', { key: 'kdel' })).status).toBe(404);
    expect((await app.request(`/v1/share/${token}`)).status).toBe(404);
    expect((await app.request(`/s/${token}`)).status).toBe(404);
    expect((await call(app, 'GET', '/v1/profile', { key: 'kother' })).status).toBe(200);
  });

  it('requires re-registration after deletion when an invite is configured', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'kdel2', invite: INVITE, body: sampleProfile });
    await call(app, 'DELETE', '/v1/profile', { key: 'kdel2' });
    // The user row is gone, so a pushing again without an invite is rejected like a new key.
    expect((await call(app, 'POST', '/v1/profile', { key: 'kdel2', body: sampleProfile })).status).toBe(401);
    expect((await call(app, 'POST', '/v1/profile', { key: 'kdel2', invite: INVITE, body: sampleProfile })).status).toBe(201);
  });

  // Documents intended server behavior: re-sharing after a delete is a fresh, deliberate
  // publish (with re-registration). The client re-pushes the profile first (repushIfNeeded),
  // so signals normally regain a backing profile; the server itself does not require one.
  it('allows a deliberate re-share after deletion, as a fresh registration', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'kre', invite: INVITE, body: sampleProfile });
    await call(app, 'DELETE', '/v1/profile', { key: 'kre' });
    const pub = await call(app, 'POST', '/v1/signals', { key: 'kre', invite: INVITE, body: [TC()] });
    expect(pub.status).toBe(200);
    const token = (await pub.json()).signals[0].shareToken as string;
    expect((await app.request(`/s/${token}`)).status).toBe(200);
  });

  it('is idempotent for a key it has never seen', async () => {
    const res = await call(makeApp(), 'DELETE', '/v1/profile', { key: 'ghost' });
    expect(res.status).toBe(200);
  });

  it('rejects a missing bearer key', async () => {
    const res = await call(makeApp(), 'DELETE', '/v1/profile', {});
    expect(res.status).toBe(401);
  });

  // Guards the CSRF-safe property: auth must stay header-based. If the key ever moved into a
  // cookie, a cross-site page could forge this destructive request with the browser's help.
  it('ignores cookies/origin — only the Authorization header authenticates', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'kcsrf', invite: INVITE, body: sampleProfile });
    const res = await app.request('/v1/profile', {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example', Cookie: 'user_key=kcsrf' }, // no Authorization
    });
    expect(res.status).toBe(401);
    expect((await call(app, 'GET', '/v1/profile', { key: 'kcsrf' })).status).toBe(200); // untouched
  });
});

describe('GET /og/:token.png (badge image)', () => {
  const statPub = {
    type: 'statBadge', disclosure: 'public',
    surfacedContent: { yeggeStage: 5, aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'proficient' } },
  };

  it('serves a PNG for a public statBadge token', async () => {
    const app = makeApp();
    const res = await call(app, 'POST', '/v1/signals', { key: 'kog', invite: INVITE, body: [statPub] });
    const token = (await res.json()).signals[0].shareToken as string;
    const img = await app.request(`/og/${token}.png`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('max-age=300');
    const body = new Uint8Array(await img.arrayBuffer());
    expect(Array.from(body.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('404s an unknown token', async () => {
    expect((await makeApp().request('/og/nope.png')).status).toBe(404);
  });

  it('404s when the statBadge is private even if another section is public', async () => {
    const app = makeApp();
    const res = await call(app, 'POST', '/v1/signals', { key: 'kog2', invite: INVITE, body: [
      TC(), { ...statPub, disclosure: 'private' },
    ] });
    const typeToken = ((await res.json()).signals as Array<{ type: string; shareToken: string | null }>)
      .find((s) => s.type === 'typeCard')!.shareToken as string;
    expect((await app.request(`/og/${typeToken}.png`)).status).toBe(404);
  });

  it('serves the fallback PNG with 200 when rendering throws', async () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
    const app = createApp(db, { inviteToken: INVITE, ogRender: () => { throw new Error('boom'); } });
    const res = await call(app, 'POST', '/v1/signals', { key: 'kog3', invite: INVITE, body: [statPub] });
    const token = (await res.json()).signals[0].shareToken as string;
    const img = await app.request(`/og/${token}.png`);
    expect(img.status).toBe(200);
    const body = new Uint8Array(await img.arrayBuffer());
    expect(Array.from(body.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('share page escapes signal content', () => {
  it('does not emit raw script tags from stored content', async () => {
    const app = makeApp();
    const xss = '<script>alert(1)</script>';
    const res = await call(app, 'POST', '/v1/signals', { key: 'kx', invite: INVITE, body: [
      { type: 'statBadge', disclosure: 'public', surfacedContent: {
        fluencyScore: 62, level: xss, yeggeStage: 4, aiFluency: { delegation: xss },
      } },
    ] });
    const token = ((await res.json()).signals as Array<{ type: string; shareToken: string }>).find((s) => s.type === 'statBadge')!.shareToken;
    const html = await (await app.request(`/s/${token}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('share page og:image tags', () => {
  it('embeds an absolute og:image with dimensions and a large twitter card', async () => {
    const app = makeApp();
    const res = await call(app, 'POST', '/v1/signals', { key: 'kogt', invite: INVITE, body: [{
      type: 'statBadge', disclosure: 'public',
      surfacedContent: { yeggeStage: 4, aiFluency: { delegation: 'developing', description: 'proficient', discernment: 'developing', diligence: 'emerging' } },
    }] });
    const token = (await res.json()).signals[0].shareToken as string;
    const html = await (await app.request(`https://aibadges-api.mindmaterial.io/s/${token}`)).text();
    expect(html).toContain(`property="og:image" content="https://aibadges-api.mindmaterial.io/og/${token}.png"`);
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="627"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});
