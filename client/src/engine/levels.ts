export interface NamedLevel {
  name: string;
  stage: number;
}

export function namedLevel(stage: number): NamedLevel {
  const clamped = Math.min(8, Math.max(1, Math.round(stage)));
  let name: string;
  if (clamped <= 2) name = 'Explorer';
  else if (clamped <= 4) name = 'Operator';
  else if (clamped <= 6) name = 'Practitioner';
  else name = 'Orchestrator';
  return { name, stage: clamped };
}
