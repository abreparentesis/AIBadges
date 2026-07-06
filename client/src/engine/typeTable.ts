// 16-type metadata. Names are AI Fluency Index' own (deliberately NOT the 16Personalities set), the
// 4-letter codes + the four temperament groups are the public-domain Jungian framework, and the
// group colors evoke the familiar scheme while staying on the app palette.
export type TypeGroup = 'Analysts' | 'Diplomats' | 'Sentinels' | 'Explorers';
export interface TypeMeta { name: string; group: TypeGroup; color: string }

const GROUP_COLOR: Record<TypeGroup, string> = {
  Analysts: '#5737f4',  // purple
  Diplomats: '#12b76a', // green
  Sentinels: '#0046ff', // blue
  Explorers: '#f5a623',  // amber
};

const NAMES: Record<string, { name: string; group: TypeGroup }> = {
  INTJ: { name: 'The Strategist', group: 'Analysts' },
  INTP: { name: 'The Theorist', group: 'Analysts' },
  ENTJ: { name: 'The Director', group: 'Analysts' },
  ENTP: { name: 'The Challenger', group: 'Analysts' },
  INFJ: { name: 'The Visionary', group: 'Diplomats' },
  INFP: { name: 'The Idealist', group: 'Diplomats' },
  ENFJ: { name: 'The Mentor', group: 'Diplomats' },
  ENFP: { name: 'The Catalyst', group: 'Diplomats' },
  ISTJ: { name: 'The Anchor', group: 'Sentinels' },
  ISFJ: { name: 'The Steward', group: 'Sentinels' },
  ESTJ: { name: 'The Organizer', group: 'Sentinels' },
  ESFJ: { name: 'The Host', group: 'Sentinels' },
  ISTP: { name: 'The Craftsman', group: 'Explorers' },
  ISFP: { name: 'The Artisan', group: 'Explorers' },
  ESTP: { name: 'The Operator', group: 'Explorers' },
  ESFP: { name: 'The Performer', group: 'Explorers' },
};

export function lookupType(code: string): TypeMeta {
  const meta = NAMES[(code ?? '').toUpperCase()];
  if (!meta) return { name: 'Undetermined', group: 'Analysts', color: '#6c737f' };
  return { name: meta.name, group: meta.group, color: GROUP_COLOR[meta.group] };
}

export const TYPE_DISCLAIMER =
  'Cognitive Type uses the public-domain Jungian dichotomies (E/I, S/N, T/F, J/P), computed from your own chat behavior. Not affiliated with, endorsed by, or derived from the Myers-Briggs Type Indicator® or The Myers-Briggs Company.';
