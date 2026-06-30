export const evidenceResponse = JSON.stringify([
  { conversationLabel: 1, timestamp: '2026-01-10T09:00:00Z', type: 'decision',
    quote: 'List the seams first.', summary: 'Asks for decomposition seams before splitting a file.' },
  { conversationLabel: 2, timestamp: '2026-05-20T14:00:00Z', type: 'reasoning_move',
    quote: 'Verify before fixing.', summary: 'Forms a hypothesis and insists on verification first.' },
]);

export const thinkingResponse = JSON.stringify([
  { claim: 'Decomposes before acting', evidenceIds: ['e1'], confidence: 'high' },
  { claim: 'Hypothesis-driven debugging', evidenceIds: ['e2'], confidence: 'medium' },
]);

export const capabilityResponse = JSON.stringify({
  aiFluency: {
    delegation: { band: 'proficient', evidenceIds: ['e1'] },
    description: { band: 'advanced', evidenceIds: ['e1'] },
    discernment: { band: 'proficient', evidenceIds: ['e2'] },
    diligence: { band: 'advanced', evidenceIds: ['e2'] },
  },
  yeggeStage: { stage: 4, evidenceIds: ['e2'] },
  domains: [{ name: 'software engineering', band: 'advanced', evidenceIds: ['e1', 'e2'] }],
});

export const trajectoryResponse = JSON.stringify({
  shifts: [
    { dimension: 'verification discipline', direction: 'rising', velocity: 'moderate', evidenceIds: ['e2'] },
  ],
});

export const typeResponse = JSON.stringify({
  code: 'INTJ', summary: 'Strategic and verification-driven; abstraction-first.', confidence: 'medium',
  axes: {
    EI: { letter: 'I', lean: 70, evidenceIds: ['e1'] }, SN: { letter: 'N', lean: 65, evidenceIds: [] },
    TF: { letter: 'T', lean: 85, evidenceIds: ['e2'] }, JP: { letter: 'J', lean: 60, evidenceIds: [] },
  },
});

export const synthesisResponse = JSON.stringify({
  thinking: JSON.parse(thinkingResponse),
  trajectory: JSON.parse(trajectoryResponse),
  type: JSON.parse(typeResponse),
});
