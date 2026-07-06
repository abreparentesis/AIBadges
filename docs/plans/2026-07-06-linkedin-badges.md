# LinkedIn Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a user's AI Literacy result on LinkedIn as a Licenses & Certifications entry (prefilled deep link) and a feed post with a personalized server-rendered badge image, plus a drift nudge when the published stage no longer matches the current profile.

**Architecture:** A new `GET /og/:token.png` route on the Hono backend rasterizes an SVG badge (stage + four fluency bands) from the owner's public statBadge signal via `@resvg/resvg-js`; the share page `/s/:token` gains `og:image` tags pointing at it. The extension's results page gains two buttons (Add to LinkedIn, Share on LinkedIn) built by pure URL helpers, and a drift banner driven by a locally stored `aibadges:publishedStage`.

**Tech Stack:** Bun, Hono, bun:sqlite, `@resvg/resvg-js`, WXT/React extension, vitest (client) / bun:test (server).

**Spec:** `docs/specs/2026-07-06-linkedin-badges-design.md`

## Global Constraints

- Toolchain is Bun in both `client/` and `server/` (`bun install`, `bun run`, `bun test` server-side, `bun run test` = vitest client-side).
- Privacy invariant: no code path may send conversation text, quotes, or capture payloads to any server. This feature adds NO new client-to-server payloads.
- Credential name is exactly `AI Fluency Index - Stage N` (hyphen, spaces as shown; renamed 2026-07-06).
- Badge image is 1200x627 PNG. OG route policy matches `/s/:token`: unknown or private = 404.
- `certId` = the share token (constant across re-adds). `organizationName` = `AIBadges`.
- Fluency band vocabulary: `emerging`, `developing`, `proficient`, `advanced` (see `BAND_RANK` in `client/entrypoints/results/App.tsx:219`).
- Commits stage files by name (never `git add -A`).
- Fonts must be OFL-licensed (Inter) and bundled with the server; the container has no system fonts.

---

### Task 1: Badge SVG template (pure function)

**Files:**
- Create: `server/src/og.ts`
- Test: `server/tests/og.test.ts`

**Interfaces:**
- Produces: `type StatBadgeContent = { yeggeStage: number | string; aiFluency?: Record<string, unknown> }` and `renderBadgeSvg(content: StatBadgeContent): string` (a complete `<svg>` document string). Task 2 adds `svgToPng` in the same file; Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/og.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { renderBadgeSvg } from '../src/og';

const content = {
  yeggeStage: 5,
  aiFluency: { delegation: 'proficient', description: 'advanced', discernment: 'developing', diligence: 'proficient' },
};

describe('renderBadgeSvg', () => {
  it('renders the stage headline and brand at 1200x627', () => {
    const svg = renderBadgeSvg(content);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="627"');
    expect(svg).toContain('AI Fluency - Stage 5');
    expect(svg).toContain('AIBADGES');
  });

  it('renders one labelled bar per fluency dimension', () => {
    const svg = renderBadgeSvg(content);
    for (const label of ['Delegation', 'Description', 'Discernment', 'Diligence']) {
      expect(svg).toContain(label);
    }
    expect(svg).toContain('advanced');
  });

  it('degrades to the stage-only layout when bands are missing', () => {
    const svg = renderBadgeSvg({ yeggeStage: 3 });
    expect(svg).toContain('AI Fluency - Stage 3');
    expect(svg).not.toContain('Delegation');
  });

  it('escapes markup in stage input', () => {
    const svg = renderBadgeSvg({ yeggeStage: '<script>' as unknown as number });
    expect(svg).not.toContain('<script>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && bun test tests/og.test.ts`
Expected: FAIL, `Cannot find module '../src/og'`.

- [ ] **Step 3: Implement `renderBadgeSvg`**

Create `server/src/og.ts`:

```ts
export type StatBadgeContent = { yeggeStage: number | string; aiFluency?: Record<string, unknown> };

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

// Visual weight of each band on the bar (0..1). Unknown bands render mid-width.
const BAND_WIDTH: Record<string, number> = { emerging: 0.3, developing: 0.55, proficient: 0.78, advanced: 1 };
const DIMS = ['delegation', 'description', 'discernment', 'diligence'] as const;
const DIM_LABEL: Record<string, string> = {
  delegation: 'Delegation', description: 'Description', discernment: 'Discernment', diligence: 'Diligence',
};

// 1200x627 LinkedIn card. Brand palette from the client holo card: deep purple field,
// mint fill. Single font family "Inter" (bundled OTFs; the container has no system fonts).
export function renderBadgeSvg(content: StatBadgeContent): string {
  const stage = esc(content.yeggeStage);
  const f = (content.aiFluency ?? {}) as Record<string, unknown>;
  const hasBands = DIMS.some((d) => typeof f[d] === 'string');

  let bars = '';
  if (hasBands) {
    const BAR_X = 660, BAR_W = 420, ROW_H = 92, TOP = 158;
    bars = DIMS.map((d, i) => {
      const band = typeof f[d] === 'string' ? (f[d] as string) : 'developing';
      const w = Math.round(BAR_W * (BAND_WIDTH[band] ?? 0.55));
      const y = TOP + i * ROW_H;
      return `
  <text x="${BAR_X}" y="${y}" font-family="Inter" font-size="26" fill="#CECBF6">${DIM_LABEL[d]}</text>
  <text x="${BAR_X + BAR_W}" y="${y}" text-anchor="end" font-family="Inter" font-size="24" fill="#AFA9EC">${esc(band)}</text>
  <rect x="${BAR_X}" y="${y + 16}" width="${BAR_W}" height="14" rx="7" fill="#534AB7"/>
  <rect x="${BAR_X}" y="${y + 16}" width="${w}" height="14" rx="7" fill="#3EFFC8"/>`;
    }).join('\n');
  }

  const headlineX = hasBands ? 90 : 600;
  const anchor = hasBands ? 'start' : 'middle';

  return `<svg width="1200" height="627" viewBox="0 0 1200 627" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="627" fill="#3C3489"/>
  <text x="${headlineX}" y="150" text-anchor="${anchor}" font-family="Inter" font-size="28" letter-spacing="4" fill="#AFA9EC">&#9679; AIBADGES</text>
  <text x="${headlineX}" y="230" text-anchor="${anchor}" font-family="Inter" font-size="40" fill="#CECBF6">AI Fluency</text>
  <text x="${headlineX}" y="330" text-anchor="${anchor}" font-family="Inter" font-size="86" font-weight="bold" fill="#FFFFFF">AI Fluency - Stage ${stage}</text>
  <text x="${headlineX}" y="520" text-anchor="${anchor}" font-family="Inter" font-size="24" fill="#AFA9EC">self-computed in the user's own AI session &#183; evidence-backed &#183; not verified by us</text>
${bars}
</svg>`;
}
```

Note: the big headline intentionally contains the full credential name string so the test and the LinkedIn cert entry share the exact wording.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && bun test tests/og.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/og.ts server/tests/og.test.ts
git commit -m "feat(server): SVG template for the LinkedIn badge image"
```

---

### Task 2: Rasterization with bundled fonts

**Files:**
- Modify: `server/src/og.ts` (append)
- Modify: `server/package.json` (dependency)
- Modify: `server/Dockerfile` (copy assets)
- Create: `server/assets/fonts/Inter-Regular.otf`, `server/assets/fonts/Inter-Bold.otf` (binary, committed)
- Test: `server/tests/og.test.ts` (append)

**Interfaces:**
- Consumes: `renderBadgeSvg` from Task 1.
- Produces: `svgToPng(svg: string): Buffer` (throws on rasterization failure) and `PNG_MAGIC: Uint8Array`. Task 3/4 consume both.

- [ ] **Step 1: Add the dependency and fonts**

```bash
cd server && bun add @resvg/resvg-js
mkdir -p assets/fonts
cd /tmp && curl -sL -o inter.zip https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip && unzip -o -q inter.zip -d inter
cp inter/extras/otf/Inter-Regular.otf inter/extras/otf/Inter-Bold.otf /Users/abrep/ClaudeCode/AIBadges/server/assets/fonts/
```

If the release URL changes, any OFL Inter static OTF/TTF works; the SVG references family name `Inter`.

- [ ] **Step 2: Write the failing test**

Append to `server/tests/og.test.ts`:

```ts
import { svgToPng, PNG_MAGIC } from '../src/og';

describe('svgToPng', () => {
  it('rasterizes the badge SVG to a real PNG', () => {
    const png = svgToPng(renderBadgeSvg(content));
    expect(png.length).toBeGreaterThan(1000);
    expect(Array.from(png.subarray(0, 4))).toEqual(Array.from(PNG_MAGIC));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test tests/og.test.ts`
Expected: FAIL, `svgToPng` not exported.

- [ ] **Step 4: Implement `svgToPng`**

Append to `server/src/og.ts`:

```ts
import { Resvg } from '@resvg/resvg-js';
import { join } from 'node:path';

export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const FONT_DIR = join(import.meta.dir, '..', 'assets', 'fonts');

export function svgToPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontFiles: [join(FONT_DIR, 'Inter-Regular.otf'), join(FONT_DIR, 'Inter-Bold.otf')],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return r.render().asPng();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test tests/og.test.ts`
Expected: all pass.

- [ ] **Step 6: Make the Docker image carry the assets**

In `server/Dockerfile`, after `COPY src ./src`, add:

```dockerfile
COPY assets ./assets
```

- [ ] **Step 7: Commit**

```bash
git add server/src/og.ts server/tests/og.test.ts server/package.json server/bun.lock server/Dockerfile server/assets/fonts/Inter-Regular.otf server/assets/fonts/Inter-Bold.otf
git commit -m "feat(server): rasterize the badge SVG with bundled Inter fonts"
```

---

### Task 3: Static fallback PNG

**Files:**
- Create: `server/scripts/make-fallback.ts` (one-off generator, committed for reproducibility)
- Create: `server/assets/og-fallback.png` (binary, committed)
- Modify: `server/src/og.ts` (append loader)
- Test: `server/tests/og.test.ts` (append)

**Interfaces:**
- Consumes: `renderBadgeSvg`, `svgToPng`.
- Produces: `loadFallbackPng(): Buffer` (reads the committed asset once, caches in module state). Task 4 consumes it.

- [ ] **Step 1: Write the generator and run it once**

Create `server/scripts/make-fallback.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBadgeSvg, svgToPng } from '../src/og';

// Generic brand card: no stage number, no bands. Served when live rendering fails.
const svg = renderBadgeSvg({ yeggeStage: '' }).replace('AI Fluency - Stage ', 'AI Fluency');
writeFileSync(join(import.meta.dir, '..', 'assets', 'og-fallback.png'), svgToPng(svg));
console.log('wrote assets/og-fallback.png');
```

Run: `cd server && bun run scripts/make-fallback.ts`
Expected: `wrote assets/og-fallback.png` and the file exists.

- [ ] **Step 2: Write the failing test**

Append to `server/tests/og.test.ts`:

```ts
import { loadFallbackPng } from '../src/og';

describe('loadFallbackPng', () => {
  it('returns the committed PNG asset', () => {
    const png = loadFallbackPng();
    expect(Array.from(png.subarray(0, 4))).toEqual(Array.from(PNG_MAGIC));
    expect(loadFallbackPng()).toBe(png); // cached
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test tests/og.test.ts`
Expected: FAIL, `loadFallbackPng` not exported.

- [ ] **Step 4: Implement the loader**

Append to `server/src/og.ts`:

```ts
import { readFileSync } from 'node:fs';

let fallback: Buffer | null = null;
export function loadFallbackPng(): Buffer {
  if (!fallback) fallback = readFileSync(join(import.meta.dir, '..', 'assets', 'og-fallback.png'));
  return fallback;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test tests/og.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/scripts/make-fallback.ts server/assets/og-fallback.png server/src/og.ts server/tests/og.test.ts
git commit -m "feat(server): committed fallback badge PNG for render failures"
```

---

### Task 4: `GET /og/:token.png` route

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/tests/app.test.ts` (append)

**Interfaces:**
- Consumes: `renderBadgeSvg`, `svgToPng`, `loadFallbackPng`, `StatBadgeContent` from `server/src/og.ts`.
- Produces: route `GET /og/:token.png`. `createApp`'s second parameter gains an optional `ogRender?: (content: StatBadgeContent) => Buffer` used ONLY by tests to force a failure; default is `(c) => svgToPng(renderBadgeSvg(c))`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/app.test.ts` (reuses `makeApp`, `call`, `INVITE`, `TC` already in the file):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && bun test tests/app.test.ts`
Expected: the four new tests FAIL (404 everywhere / unknown option).

- [ ] **Step 3: Implement the route**

In `server/src/app.ts`:

Add the import at the top:

```ts
import { renderBadgeSvg, svgToPng, loadFallbackPng, type StatBadgeContent } from './og';
```

Change the signature:

```ts
export function createApp(db: Database, opts: { inviteToken: string; ogRender?: (content: StatBadgeContent) => Buffer }) {
```

Add the route next to `GET /s/:token`:

```ts
  // GET /og/:token.png — the LinkedIn og:image. Renders the token owner's PUBLIC statBadge.
  // Same policy as /s/:token: unknown or private is a plain 404 (no existence oracle).
  const ogRender = opts.ogRender ?? ((c: StatBadgeContent) => svgToPng(renderBadgeSvg(c)));
  app.get('/og/:token.png', (c) => {
    const owner = db.query("SELECT user_key FROM signals WHERE share_token = ? AND disclosure = 'public'")
      .get(c.req.param('token')) as { user_key: string } | null;
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
```

Hono note: `:token.png` in a path pattern does not strip the extension — use the pattern `'/og/:token{.+\\.png}'` if the plain form fails, and strip the suffix with `c.req.param('token').replace(/\.png$/, '')`. Verify against the failing test and use whichever form makes it pass; keep the URL shape `/og/<token>.png` externally.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && bun test`
Expected: all pass (31 total).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/tests/app.test.ts
git commit -m "feat(server): /og/:token.png badge image route with fallback"
```

---

### Task 5: OG tags on the share page

**Files:**
- Modify: `server/src/app.ts` (`renderReportPage` signature + `/s/:token` handler)
- Test: `server/tests/app.test.ts` (append)

**Interfaces:**
- Consumes: the `/og/:token.png` route URL shape from Task 4.
- Produces: `renderReportPage(signals, provenance, ogImageUrl?: string)` — third param optional so existing tests keep passing.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test tests/app.test.ts`
Expected: the new test FAILS (no og:image in HTML).

- [ ] **Step 3: Implement**

In `server/src/app.ts`:

1. Change `renderReportPage` to accept and emit the image tags. Signature:

```ts
function renderReportPage(
  signals: Array<{ type: string; surfacedContent: Record<string, unknown> }>,
  provenance: string,
  ogImageUrl?: string,
): string {
```

Inside, where the `og` block is built, append when `ogImageUrl` is set (and replace the existing `twitter:card` meta):

```ts
  const ogImage = ogImageUrl
    ? `<meta property="og:image" content="${esc(ogImageUrl)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="627">
<meta name="twitter:card" content="summary_large_image">`
    : '<meta name="twitter:card" content="summary">';
```

Emit `${ogImage}` right after `${og}` in the returned HTML head, and remove the old inline `twitter:card` from the `og` template string so it is not duplicated.

2. In the `/s/:token` handler, derive the absolute origin (Caddy terminates TLS; trust the forwarded proto when present):

```ts
    const url = new URL(c.req.url);
    const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const ogImageUrl = `${proto}://${url.host}/og/${c.req.param('token')}.png`;
```

Pass it as the third argument to `renderReportPage(...)`.

- [ ] **Step 4: Run the full server suite**

Run: `cd server && bun test`
Expected: all pass, including the pre-existing share-viewer tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/tests/app.test.ts
git commit -m "feat(server): og:image tags on the share page for LinkedIn previews"
```

---

### Task 6: Client LinkedIn URL builders

**Files:**
- Create: `client/src/sync/linkedin.ts`
- Test: `client/tests/sync/linkedin.test.ts`

**Interfaces:**
- Produces (Task 7 consumes exactly these):

```ts
certName(stage: number | string): string                       // "AI Fluency - Stage 5"
buildAddToProfileUrl(o: { stage: number | string; computedAt: string; shareUrl: string; token: string }): string
buildShareOnLinkedInUrl(shareUrl: string): string
stageDrift(publishedStage: string, currentStage: number | string): boolean
```

- [ ] **Step 1: Write the failing tests**

Create `client/tests/sync/linkedin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { certName, buildAddToProfileUrl, buildShareOnLinkedInUrl } from '../../src/sync/linkedin';

describe('certName', () => {
  it('uses the exact credential wording', () => {
    expect(certName(5)).toBe('AI Fluency - Stage 5');
  });
});

describe('buildAddToProfileUrl', () => {
  const url = buildAddToProfileUrl({
    stage: 5, computedAt: '2026-07-06T10:00:00Z',
    shareUrl: 'https://aibadges-api.mindmaterial.io/s/tok123', token: 'tok123',
  });
  const params = new URL(url).searchParams;

  it('targets the certification form', () => {
    expect(url.startsWith('https://www.linkedin.com/profile/add?')).toBe(true);
    expect(params.get('startTask')).toBe('CERTIFICATION_NAME');
  });
  it('prefills name, org, dates, url, and id', () => {
    expect(params.get('name')).toBe('AI Fluency - Stage 5');
    expect(params.get('organizationName')).toBe('AIBadges');
    expect(params.get('issueYear')).toBe('2026');
    expect(params.get('issueMonth')).toBe('7');
    expect(params.get('certUrl')).toBe('https://aibadges-api.mindmaterial.io/s/tok123');
    expect(params.get('certId')).toBe('tok123');
  });
});

describe('buildShareOnLinkedInUrl', () => {
  it('URL-encodes the share page into the offsite share link', () => {
    expect(buildShareOnLinkedInUrl('https://aibadges-api.mindmaterial.io/s/tok123'))
      .toBe('https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Faibadges-api.mindmaterial.io%2Fs%2Ftok123');
  });
});

describe('stageDrift', () => {
  it('detects a published stage that differs from the current one', () => {
    expect(stageDrift('5', 6)).toBe(true);
  });
  it('is false when equal, and false when nothing was published', () => {
    expect(stageDrift('5', 5)).toBe(false);
    expect(stageDrift('', 6)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && bunx vitest run tests/sync/linkedin.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `client/src/sync/linkedin.ts`:

```ts
// LinkedIn integration is pure URL construction; nothing is fetched and nothing leaves
// the device beyond the user opening linkedin.com themselves.

export function certName(stage: number | string): string {
  return `AI Fluency - Stage ${stage}`;
}

export function buildAddToProfileUrl(o: { stage: number | string; computedAt: string; shareUrl: string; token: string }): string {
  const d = new Date(o.computedAt);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: certName(o.stage),
    organizationName: 'AIBadges',
    issueYear: String(d.getUTCFullYear()),
    issueMonth: String(d.getUTCMonth() + 1),
    certUrl: o.shareUrl,
    certId: o.token,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export function buildShareOnLinkedInUrl(shareUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
}

// True when a badge was published at some stage and the current profile disagrees.
export function stageDrift(publishedStage: string, currentStage: number | string): boolean {
  return publishedStage !== '' && publishedStage !== String(currentStage);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && bunx vitest run tests/sync/linkedin.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/sync/linkedin.ts client/tests/sync/linkedin.test.ts
git commit -m "feat(client): LinkedIn add-to-profile and share URL builders"
```

---

### Task 7: Results page — buttons, published stage, drift nudge

**Files:**
- Modify: `client/entrypoints/results/App.tsx`

**Interfaces:**
- Consumes: `certName`, `buildAddToProfileUrl`, `buildShareOnLinkedInUrl` from Task 6; existing `shareUrl` from `client/src/config.ts`; existing `sigFor`, `isPublic`, `changeDisclosure`, `deleteServerData`, `kv`, `BackendSync`, `repushIfNeeded`.
- Produces: UI only. New kv key: `aibadges:publishedStage` (string; `''` = nothing published).

- [ ] **Step 1: Wire imports and state**

In `client/entrypoints/results/App.tsx`:

Add the import:

```tsx
import { buildAddToProfileUrl, buildShareOnLinkedInUrl, stageDrift } from '../../src/sync/linkedin';
```

Add state next to the other `useState` calls in `App`:

```tsx
const [publishedStage, setPublishedStage] = useState('');
```

In `load()`, after the signals block:

```tsx
setPublishedStage((await kv.get('aibadges:publishedStage')) ?? '');
```

- [ ] **Step 2: Record the published stage on publish, clear it on delete**

In `changeDisclosure`, after the successful `kv.set('aibadges:signals', ...)` line, add:

```tsx
if (sig.type === 'statBadge') {
  const stage = disclosure === 'public'
    ? String((sig.surfacedContent as { yeggeStage?: number | string }).yeggeStage ?? '') : '';
  setPublishedStage(stage);
  await kv.set('aibadges:publishedStage', stage);
}
```

In `deleteServerData`, after `await kv.set(NEEDS_REPUSH_KEY, '1');`, add:

```tsx
setPublishedStage('');
await kv.set('aibadges:publishedStage', '');
```

- [ ] **Step 3: Add the republish helper**

Add below `changeDisclosure` (bypasses its same-disclosure no-op guard on purpose — this is an explicit refresh):

```tsx
// Explicit refresh: pushes the CURRENT local statBadge content (kv signals are re-distilled
// after every run) so the share page and og image match, then reopens LinkedIn's form.
async function updateLinkedInBadge() {
  if (busy) return;
  const sig = sigFor('statBadge');
  if (!sig?.shareToken) return;
  setBusy('statBadge');
  try {
    const userKey = await ensureUserKey(kv);
    const sync = new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey });
    await repushIfNeeded(kv, sync);
    const [res] = await sync.setSignals([{ type: 'statBadge', surfacedContent: sig.surfacedContent, disclosure: 'public' }]);
    const next = signals.map((s) => (s.type === 'statBadge' ? { ...s, disclosure: 'public' as Signal['disclosure'], shareToken: res?.shareToken ?? null } : s));
    setSignals(next);
    await kv.set('aibadges:signals', JSON.stringify(next));
    const stage = String((sig.surfacedContent as { yeggeStage?: number | string }).yeggeStage ?? '');
    setPublishedStage(stage);
    await kv.set('aibadges:publishedStage', stage);
    if (res?.shareToken && profile) {
      window.open(buildAddToProfileUrl({
        stage, computedAt: profile.computedAt,
        shareUrl: shareUrl(res.shareToken), token: res.shareToken,
      }), '_blank');
    }
  } catch (e) { alert('Badge update failed: ' + String(e)); } finally { setBusy(''); }
}
```

The function reads the stage from `sig.surfacedContent` (the kv signals are re-distilled after every run, so this is the current stage), never from `cap` — `cap` is only in scope inside the render body. The `profile` guard makes the `computedAt` access safe without non-null assertions.

- [ ] **Step 4: Render the buttons and the drift banner in the literacy tab**

Inside the `tab === 'literacy' && cap` block, directly after the closing `/>` of the `SecH dot={t.blue} title="Your four fluencies"` element (client/entrypoints/results/App.tsx:278-282), insert:

```tsx
{(() => {
  const sig = sigFor('statBadge');
  if (!sig || sig.disclosure !== 'public' || !sig.shareToken) return null;
  const link = shareUrl(sig.shareToken);
  const drift = stageDrift(publishedStage, cap.yeggeStage.stage);
  return (
    <div style={{ margin: '0 0 16px' }}>
      {drift && (
        <div className="bb-card" style={{ marginBottom: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderLeft: `4px solid ${t.blue}` }}>
          <span style={{ fontSize: 13 }}>
            Your LinkedIn badge says Stage {publishedStage} &mdash; you&rsquo;re now at Stage {cap.yeggeStage.stage}.
          </span>
          <button type="button" className="bb-btn" onClick={() => void updateLinkedInBadge()} disabled={busy !== ''}
            style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 50, padding: '5px 14px', border: `1px solid ${t.g300}`, background: t.white }}>
            Update LinkedIn badge
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href={buildAddToProfileUrl({ stage: cap.yeggeStage.stage, computedAt: profile.computedAt, shareUrl: link, token: sig.shareToken })}
          target="_blank" rel="noreferrer"
          style={{ fontSize: 13, fontWeight: 600, textDecoration: 'none', borderRadius: 50, padding: '7px 16px', background: '#0A66C2', color: '#fff' }}>
          Add to LinkedIn profile
        </a>
        <a href={buildShareOnLinkedInUrl(link)} target="_blank" rel="noreferrer"
          style={{ fontSize: 13, fontWeight: 600, textDecoration: 'none', borderRadius: 50, padding: '7px 16px', border: `1px solid ${t.g300}`, color: t.g700 }}>
          Share on LinkedIn
        </a>
      </div>
    </div>
  );
})()}
```

(`#0A66C2` is LinkedIn's brand blue; both open in a new tab. The buttons vanish whenever the section is private, per the spec.)

- [ ] **Step 5: Build and run the client suite**

Run: `cd client && bun run test && bun run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/entrypoints/results/App.tsx
git commit -m "feat(client): LinkedIn buttons and stage-drift nudge on the results page"
```

---

### Task 8: Deploy and verify end to end

**Files:**
- None (operational).

**Interfaces:**
- Consumes: everything above, deployed.

- [ ] **Step 1: Full local suites**

Run: `cd server && bun test && cd ../client && bun run test`
Expected: all pass.

- [ ] **Step 2: Deploy the backend** (runbook in memory `aibadges-backend-deploy`)

```bash
rsync -az --exclude '.env' --exclude '.env.bak.*' --exclude 'data/' --exclude 'node_modules/' --exclude '.git/' server/ hetzner-billions:/opt/aibadges-backend/
ssh hetzner-billions 'cd /opt/aibadges-backend && docker compose up -d --build'
curl -s https://aibadges-api.mindmaterial.io/health
```

Expected: `{"ok":true}`. Note: `@resvg/resvg-js` ships prebuilt musl binaries, so `bun install` inside the alpine image needs no build toolchain; if the build fails on the native module, switch the Dockerfile base to `oven/bun:1` (Debian) and rebuild.

- [ ] **Step 3: Live smoke of the image route**

With a real public statBadge token (from the user's own share link):

```bash
curl -s -o /tmp/badge.png -w '%{http_code} %{content_type}\n' https://aibadges-api.mindmaterial.io/og/<token>.png
file /tmp/badge.png
```

Expected: `200 image/png`, `PNG image data, 1200 x 627`.

- [ ] **Step 4: LinkedIn Post Inspector**

Manual: open https://www.linkedin.com/post-inspector/, inspect `https://aibadges-api.mindmaterial.io/s/<token>`.
Expected: the badge image appears as the preview; title and description present. (Also forces a fresh scrape after any re-publish.)

- [ ] **Step 5: Extension check**

Reload the unpacked extension from `client/.output/chrome-mv3`, open the results page, AI Literacy tab: with the section public, both buttons render; clicking "Add to LinkedIn profile" opens the prefilled form; toggling the section private hides them.

- [ ] **Step 6: Commit anything outstanding and push**

```bash
git push origin main
```

Manual follow-up outside this plan: create the AIBadges LinkedIn company page, then switch `organizationName` to `organizationId` in `client/src/sync/linkedin.ts`.
