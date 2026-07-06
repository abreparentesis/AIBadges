import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBadgeSvg, svgToPng } from '../src/og';

// Generic brand card: no stage number, no bands. Served when live rendering fails.
const svg = renderBadgeSvg({ yeggeStage: '' }).replace('AI Fluency - Stage ', 'AI Fluency');
writeFileSync(join(import.meta.dir, '..', 'assets', 'og-fallback.png'), svgToPng(svg));
console.log('wrote assets/og-fallback.png');
