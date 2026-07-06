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

import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
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

let fallback: Buffer | null = null;
export function loadFallbackPng(): Buffer {
  if (!fallback) fallback = readFileSync(join(import.meta.dir, '..', 'assets', 'og-fallback.png'));
  return fallback;
}
