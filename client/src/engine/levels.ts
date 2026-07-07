export interface NamedLevel {
  name: string;
  stage: number;
}

/**
 * Human ladder for the internal Yegge stage (1-8). Names are deliberately plain — a
 * recruiter should understand them without a legend. "Expert" (7-8) is reachable only
 * when an agentic source is ingested; chat-only profiles cap at Advanced.
 */
export function namedLevel(stage: number): NamedLevel {
  const clamped = Math.min(8, Math.max(1, Math.round(stage)));
  let name: string;
  if (clamped <= 2) name = 'Beginner';
  else if (clamped <= 4) name = 'Intermediate';
  else if (clamped <= 6) name = 'Advanced';
  else name = 'Expert';
  return { name, stage: clamped };
}
