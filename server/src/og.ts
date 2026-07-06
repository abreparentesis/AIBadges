import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type StatBadgeContent = { yeggeStage: number | string; aiFluency?: Record<string, unknown> };

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

// How many of the four scale segments a band fills. Unknown bands render mid-scale.
const BAND_TICKS: Record<string, number> = { emerging: 1, developing: 2, proficient: 3, advanced: 4 };
const DIMS = ['delegation', 'description', 'discernment', 'diligence'] as const;
const DIM_LABEL: Record<string, string> = {
  delegation: 'Delegation', description: 'Description', discernment: 'Discernment', diligence: 'Diligence',
};

// Mirrors client/src/engine/levels.ts namedLevel(); duplicated because the server
// deliberately has no dependency on client code.
function levelName(stage: number): string {
  if (!Number.isFinite(stage) || stage < 1) return ''; // no tier claim without a real stage (fallback image)
  const s = Math.min(8, Math.max(1, Math.round(stage)));
  if (s <= 2) return 'Explorer';
  if (s <= 4) return 'Operator';
  if (s <= 6) return 'Practitioner';
  return 'Orchestrator';
}

// Certificate palette: near-white ground with a whisper of the brand hue, deep indigo ink,
// brand purple used as ink for accents (never as a field). "Modern institution": Besley
// (a Clarendon revival, the letterform of official ledger printing) for the display line,
// Inter (the product's committed family) for labels.
const INK = '#17103B';
const PURPLE = '#5737F4';
const MUTED = '#5D5876';
const HAIRLINE = '#D9D3EE';
const GROUND = '#FBFAFD';

// 1200x627 LinkedIn og card rendered as a certificate.
export function renderBadgeSvg(content: StatBadgeContent): string {
  const stage = esc(content.yeggeStage);
  const stageNum = Number(content.yeggeStage);
  const tier = levelName(stageNum);
  const f = (content.aiFluency ?? {}) as Record<string, unknown>;
  const hasBands = DIMS.some((d) => typeof f[d] === 'string');

  // Four-dimension row: label above a 4-segment engraved scale, band word beneath.
  let dimensions = '';
  if (hasBands) {
    const COL_W = 232, GAP = 24, ROW_Y = 408;
    const totalW = 4 * COL_W + 3 * GAP;
    const startX = (1200 - totalW) / 2;
    dimensions = DIMS.map((d, i) => {
      const band = typeof f[d] === 'string' ? (f[d] as string) : 'developing';
      const ticks = BAND_TICKS[band] ?? 2;
      const cx = startX + i * (COL_W + GAP) + COL_W / 2;
      const SEG_W = 34, SEG_GAP = 8;
      const segsX = cx - (4 * SEG_W + 3 * SEG_GAP) / 2;
      const segments = [0, 1, 2, 3].map((n) =>
        `<rect x="${segsX + n * (SEG_W + SEG_GAP)}" y="${ROW_Y + 18}" width="${SEG_W}" height="6" rx="3" fill="${n < ticks ? PURPLE : HAIRLINE}"/>`,
      ).join('');
      return `
  <text x="${cx}" y="${ROW_Y}" text-anchor="middle" font-family="Inter" font-size="21" font-weight="bold" fill="${INK}">${DIM_LABEL[d]}</text>
  ${segments}
  <text x="${cx}" y="${ROW_Y + 52}" text-anchor="middle" font-family="Inter" font-size="18" fill="${MUTED}">${esc(band)}</text>`;
    }).join('\n');
  }

  const subline = hasBands
    ? `${tier ? `${esc(tier)} tier &#183; ` : ''}assessed across four fluency dimensions`
    : `${tier ? `${esc(tier)} tier &#183; ` : ''}an evidence-backed reflection of AI working maturity`;

  // Seal: engraved concentric rings with microtext, stage numeral at the center.
  // Sits bottom-right like a notary seal; the attestation line is left-anchored to clear it.
  const sealCx = 1088, sealCy = 514, sealR = 54;
  const seal = `
  <defs>
    <path id="sealring" d="M ${sealCx} ${sealCy - 41} a 41 41 0 1 1 -0.01 0 z"/>
  </defs>
  <circle cx="${sealCx}" cy="${sealCy}" r="${sealR}" fill="none" stroke="${PURPLE}" stroke-width="1.6"/>
  <circle cx="${sealCx}" cy="${sealCy}" r="${sealR - 26}" fill="none" stroke="${PURPLE}" stroke-width="1"/>
  <text font-family="Inter" font-size="10" letter-spacing="1.6" fill="${PURPLE}">
    <textPath href="#sealring">SELF-COMPUTED &#183; EVIDENCE-BACKED &#183;</textPath>
  </text>
  <text x="${sealCx}" y="${sealCy - 8}" text-anchor="middle" font-family="Inter" font-size="9" letter-spacing="2" fill="${PURPLE}">STAGE</text>
  <text x="${sealCx}" y="${sealCy + 26}" text-anchor="middle" font-family="Besley" font-size="38" font-weight="bold" fill="${INK}">${stage || '&#9679;'}</text>`;

  const provenanceY = hasBands ? 552 : 500;

  return `<svg width="1200" height="627" viewBox="0 0 1200 627" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="627" fill="${GROUND}"/>
  <rect x="26" y="26" width="1148" height="575" fill="none" stroke="${INK}" stroke-width="2"/>
  <rect x="38" y="38" width="1124" height="551" fill="none" stroke="${PURPLE}" stroke-width="0.75"/>
  <text x="600" y="106" text-anchor="middle" font-family="Inter" font-size="23" font-weight="bold" letter-spacing="6" fill="${INK}">&#9679; AIBADGES</text>
  <line x1="470" y1="140" x2="730" y2="140" stroke="${HAIRLINE}" stroke-width="1"/>
  <text x="600" y="196" text-anchor="middle" font-family="Inter" font-size="19" letter-spacing="5" fill="${PURPLE}">CREDENTIAL</text>
  <text x="600" y="290" text-anchor="middle" font-family="Besley" font-size="66" font-weight="bold" fill="${INK}">AI Fluency Index - Stage ${stage}</text>
  <text x="600" y="342" text-anchor="middle" font-family="Inter" font-size="22" fill="${MUTED}">${subline}</text>
${dimensions}
  <line x1="120" y1="${provenanceY - 34}" x2="944" y2="${provenanceY - 34}" stroke="${HAIRLINE}" stroke-width="1"/>
  <text x="120" y="${provenanceY}" font-family="Inter" font-size="17" fill="${MUTED}">Self-computed in the holder's own AI session &#183; every claim anchored to evidence &#183; not verified by AIBadges</text>
${seal}
</svg>`;
}

export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const FONT_DIR = join(import.meta.dir, '..', 'assets', 'fonts');

export function svgToPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontFiles: [
        join(FONT_DIR, 'Inter-Regular.otf'),
        join(FONT_DIR, 'Inter-Bold.otf'),
        join(FONT_DIR, 'Besley-Medium.ttf'),
        join(FONT_DIR, 'Besley-Bold.ttf'),
      ],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return r.render().asPng();
}

let fallback: Buffer | null = null;
export function loadFallbackPng(): Buffer {
  if (!fallback) fallback = readFileSync(join(import.meta.dir, '..', 'assets', 'og-fallback.png'));
  return fallback;
}
