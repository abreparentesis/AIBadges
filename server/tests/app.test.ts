import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createApp, renderCardBody } from '../src/app';
import { migrate } from '../src/db';

const INVITE = 'test-invite-token';

function makeApp() {
  const db = new Database(':memory:');
  migrate(db);
  return createApp(db, { inviteToken: INVITE });
}

// Permissionless server: no invite token configured, any new key may register.
function makeOpenApp() {
  const db = new Database(':memory:');
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
  it('renders the full report for a public signal and 404s an unknown token', async () => {
    const app = makeApp();
    await call(app, 'POST', '/v1/profile', { key: 'k1', invite: INVITE, body: sampleProfile });
    const pub = await call(app, 'POST', '/v1/signals', {
      key: 'k1',
      body: [{ type: 'identityCard', surfacedContent: { headline: 'Decomposes before acting', thinking: [{ claim: 'Decomposes before acting', confidence: 'high' }] }, disclosure: 'public' }],
    });
    const token = (await pub.json()).signals[0].shareToken as string;

    const page = await app.request(`/s/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('Decomposes before acting');
    expect(html).toContain('AIBadges');
    expect(html).toContain('How you think');

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
    expect(html).toContain('INTJ'); // public type code
    expect(html).toContain('verification discipline'); // public trajectory dimension
    expect(html).not.toContain('SECRET-PRIVATE-CLAIM'); // private identity omitted
    expect(html).not.toContain('How you think'); // private section header absent
  });
});

describe('AI Literacy (statBadge) share render', () => {
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
    expect(html).toContain('AI Literacy');
    expect(html).toContain('Stage 5');
    expect(html).toContain('proficient');
    expect(html).toContain('advanced');
  });

  it('does not render the AI Literacy section when statBadge is private', async () => {
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
    expect(html).not.toContain('AI Literacy');
    expect(html).not.toContain('Stage 5');
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

describe('share page escapes signal content', () => {
  it('does not emit raw script tags from stored content', async () => {
    const app = makeApp();
    const xss = '<script>alert(1)</script>';
    const res = await call(app, 'POST', '/v1/signals', { key: 'kx', invite: INVITE, body: [
      TC({ name: xss, summary: xss }),
      { type: 'identityCard', disclosure: 'public', surfacedContent: { headline: xss, thinking: [{ claim: xss, confidence: 'high' }] } },
    ] });
    const token = ((await res.json()).signals as Array<{ type: string; shareToken: string }>).find((s) => s.type === 'typeCard')!.shareToken;
    const html = await (await app.request(`/s/${token}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
