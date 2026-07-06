import type { RawConversation } from '../capture/types';
import type { EvidenceUnit, Capability } from '../engine/types';

function renderConvos(convos: RawConversation[]): string {
  return convos.map((c, i) =>
    `[${i + 1}] (${c.createdAt})\n` +
    c.messages.map((m) => `${m.role}: ${m.text}`).join('\n')
  ).join('\n\n');
}

function renderEvidence(evidence: EvidenceUnit[]): string {
  return evidence.map((e) => `- ${e.id} (${e.timestamp}, ${e.type}): ${e.summary} | quote: "${e.quote}"`).join('\n');
}

export function evidencePrompt(convos: RawConversation[]): string {
  return [
    "You are extracting behavioral evidence from a person's AI chat transcripts.",
    'Conversations are numbered [1], [2], and so on. Be concrete; quote the USER; never invent.',
    'Prefer a few well-grounded units over many vague ones. Skip a conversation that shows nothing notable.',
    'Return ONLY a JSON array. Each item: {conversationLabel, timestamp, type, quote, summary}',
    'where conversationLabel is the [n] number, and type is one of: decision, reasoning_move, episode, preference.',
    '',
    'TRANSCRIPTS:',
    renderConvos(convos),
  ].join('\n');
}

export function thinkingPrompt(evidence: EvidenceUnit[]): string {
  return [
    'From this evidence, describe how this person THINKS: reasoning style, decision patterns, intellectual character.',
    'Be an honest mirror, not flattering. Each claim MUST cite the evidence ids (e.g. e1, e3) that justify it.',
    'Make fewer claims if the evidence is thin; do not pad. Return ONLY a JSON array.',
    'Each item: {claim, evidenceIds, confidence} where confidence is low|medium|high.',
    '',
    'EVIDENCE:',
    renderEvidence(evidence),
  ].join('\n');
}

export function capabilityPrompt(evidence: EvidenceUnit[]): string {
  return [
    "Assess this person's AI-working capability strictly from the evidence below, which comes from CHAT",
    'transcripts only: you see how they converse with AI, not what they do with the output afterward.',
    'Score four AI-fluency dimensions with a band (emerging|developing|proficient|advanced). Be a critical',
    'assessor and do NOT flatter. For each dimension cite the evidence ids whose quotes DEMONSTRATE that exact',
    'dimension — a skeptic reading only those quotes must agree the band is earned. Do not reuse a quote across',
    'dimensions unless it genuinely evidences each.',
    'CRITICAL: every fluency measures how the person ENGAGES THE AI, not the topic or the facts they shared.',
    'Supplying information the model could not have known (a wine\'s vintage, that a flat is co-owned with a spouse,',
    'which company to look into, a date or price) is ordinary context-giving — it counts at most toward description,',
    'and NEVER toward discernment, diligence, or delegation. A quote earns a dimension only if, read entirely on its',
    'own, it shows that dimension\'s specific action; if the same sentence would read identically in a message to a',
    'human who had given no prior answer, it is neither discernment nor diligence.',
    '- delegation: handing off whole, well-scoped tasks. Handing the model substantial self-contained jobs (e.g.',
    '  "evaluate this opportunity end to end", "produce a market study and business plan") is proficient or advanced',
    '  — do not under-rate it. Merely naming a task\'s subject is not delegation. A chat rarely shows the deliberate',
    '  CHOICE of what to delegate; credit that only when the person explicitly says what they keep vs hand off,',
    '  otherwise score only the hand-offs actually present.',
    '- description: how clearly they prompt — an explicit goal, constraints, and often a requested output format. The',
    '  ONLY place ordinary context-giving belongs, but advanced description shows real structure — a clear goal with',
    '  genuine constraints, usually a requested format — not sheer volume; raw context dumps with no goal or',
    '  constraints are at most developing.',
    '- discernment: the person REACTING TO the model\'s output — correcting it, disagreeing, rejecting or redoing a weak',
    '  answer, catching an error, narrowing an over-broad reply. The quote must show a judgment of what the AI produced;',
    '  stating one\'s own facts, opinions, or preferences is NOT discernment.',
    '- diligence: verifying what the AI GAVE before acting on it — checking or challenging its sources or answer,',
    '  cross-checking a claim it made, testing its output, or iterating to fix a flaw it produced. Hardest to see in',
    '  chat; a first-message request for sources or ordinary re-prompting is NOT diligence. If the quotes do not show',
    '  verification of the model\'s output, score it emerging/developing with only truly relevant evidenceIds (or []).',
    'A band is earned by DEMONSTRATING evidence weight: advanced needs several clear examples across different',
    'conversations, proficient at least a couple, and a single or ambiguous quote supports at most developing. When',
    'torn between two bands, choose the LOWER, and never inflate. Use emerging/developing whenever the demonstrating',
    'evidence is genuinely thin.',
    'SELF-AUDIT before output: re-read every quote you cited under each dimension and DELETE any that, read alone, does',
    'not show that dimension\'s specific engagement with the AI. Concrete test — for discernment or diligence the',
    'surviving quote MUST point to something the AI said or produced (if you cannot name the AI output it reacts to or',
    'checks, delete it); for delegation the quote MUST contain the actual handed-off task, not merely its topic. Then',
    'set each band to what the SURVIVING quotes support (0-1 genuine → emerging/developing).',
    'Across the four dimensions, prefer distinct evidence ids and do not cite any single id more than twice; if a',
    'behavior recurs, cite additional quotes rather than reusing one.',
    '',
    'Fill yeggeStage too, but keep it light: the overall stage is RECOMPUTED from your four bands afterward, so just',
    'give your rough 1-6 read — chat cannot evidence the 7-8 tier (orchestrating autonomous agents and tools).',
    '',
    'List only domains the evidence actually supports. Each scored item cites evidence ids. Return ONLY JSON shaped exactly like:',
    '{"aiFluency":{"delegation":{"band":..,"evidenceIds":[..]},"description":{..},"discernment":{..},"diligence":{..}},',
    '"yeggeStage":{"stage":N,"evidenceIds":[..]},"domains":[{"name":..,"band":..,"evidenceIds":[..]}]}',
    '',
    'EVIDENCE:',
    renderEvidence(evidence),
  ].join('\n');
}

// Adversarial second pass over the four fluency bands: re-judge each cited quote against its exact
// dimension and re-band from what survives. A separate call (not the inline self-audit) because one
// combined scoring reply reliably keeps quotes that don't earn their band. Mirrors the ChatGPT step 3.
export function capabilityAuditPrompt(evidence: EvidenceUnit[], draft: Capability): string {
  const byId = new Map(evidence.map((e) => [e.id, e] as const));
  const renderDim = (name: string, d: { band: string; evidenceIds: string[] }) =>
    `${name} — currently ${d.band}\n` +
    (d.evidenceIds.length
      ? d.evidenceIds.map((id) => `    ${id}: "${byId.get(id)?.quote ?? '(missing)'}"`).join('\n')
      : '    (no quotes)');
  const f = draft.aiFluency;
  return [
    'Audit the four AI-fluency bands below as a hostile skeptic whose only job is to REJECT any band its',
    'quotes do not earn. For each dimension, DELETE every evidence id whose quote, read alone, does not',
    'genuinely demonstrate it, then RE-BAND from what survives.',
    '- delegation: keep only a handed-off, self-contained TASK. DELETE plain information questions (asking',
    '  for a fact is not delegating a task).',
    '- description: keep only real prompt structure (a goal WITH constraints, often a requested output',
    '  format). DELETE terse context fragments and ordinary one-line questions — supplying a fact or',
    '  answering the AI\'s clarifying question is not advanced prompting.',
    '- discernment: keep only quotes that REACT TO the AI\'s output (correct/reject/narrow it, catch an',
    '  error). DELETE the person\'s own facts, opinions, preferences, or fresh questions.',
    '- diligence: keep only quotes that verify what the AI GAVE (challenge a source it cited, cross-check a',
    '  claim it made, test its output). DELETE fresh factual questions and one-word asks.',
    'RE-BAND strictly by survivors: 0 → emerging, 1 → developing, 2 → proficient, 3+ across 2+ different',
    'conversations → advanced. When in doubt choose the LOWER band. Audit domains the same way.',
    'Reuse only these evidence ids; never invent new ones. Return ONLY JSON shaped exactly like:',
    '{"aiFluency":{"delegation":{"band":..,"evidenceIds":[..]},"description":{..},"discernment":{..},"diligence":{..}},',
    '"yeggeStage":{"stage":N,"evidenceIds":[..]},"domains":[{"name":..,"band":..,"evidenceIds":[..]}]}',
    '',
    'CURRENT BANDS AND THEIR QUOTES:',
    renderDim('delegation', f.delegation),
    renderDim('description', f.description),
    renderDim('discernment', f.discernment),
    renderDim('diligence', f.diligence),
    ...(draft.domains.length ? ['domains:', ...draft.domains.map((d) => renderDim(d.name, d))] : []),
    '',
    'FULL EVIDENCE (for context):',
    renderEvidence(evidence),
  ].join('\n');
}

export function synthesisPrompt(evidence: EvidenceUnit[]): string {
  return [
    'From the evidence below, produce a SINGLE JSON object describing this person in three parts.',
    'Be an honest, critical mirror; do NOT flatter. Cite the evidence ids (e.g. e1, e3) that justify',
    'every scored item. Make fewer items when evidence is thin; never invent. Evidence is oldest-to-newest.',
    '',
    'Return ONLY this JSON shape:',
    '{',
    '  "thinking": [{"claim": "...", "evidenceIds": ["e1"], "confidence": "low|medium|high"}],',
    '  "trajectory": {"shifts": [{"dimension": "...", "direction": "rising|falling|steady", "velocity": "slow|moderate|fast", "evidenceIds": ["e1"]}]},',
    '  "type": {"code": "INTJ", "summary": "...", "confidence": "low|medium|high", "axes": {"EI": {"letter": "I", "lean": 70, "evidenceIds": ["e1"]}, "SN": {"letter":"N","lean":65,"evidenceIds":[]}, "TF": {"letter":"T","lean":80,"evidenceIds":[]}, "JP": {"letter":"J","lean":60,"evidenceIds":[]}}}',
    '}',
    '',
    'thinking: reasoning style, decision patterns, intellectual character.',
    'trajectory: how the person is changing over time; return an empty shifts list if there is too little to tell.',
    'type: a behavioral cognitive type from four independent dichotomies judged ONLY from how they write/reason',
    '  (not a questionnaire). E/I (outward,verbose,thinks-by-talking vs inward,concise,reflective); S/N (concrete,',
    '  literal vs abstract,pattern-focused); T/F (logic/principle-first vs values/people-first); J/P (planful,',
    '  closure-seeking vs open-ended,exploratory). For each axis: letter = chosen pole, lean = 50-100 (50 barely,',
    '  100 strongly), and cite evidence ids (or [] if weak). code = the four letters in E/I,S/N,T/F,J/P order.',
    '  Keep lean near 50 and confidence low where evidence is thin. Omit "type" entirely if there is no signal.',
    '',
    'EVIDENCE (chronological):',
    renderEvidence(evidence),
  ].join('\n');
}

export function trajectoryPrompt(evidence: EvidenceUnit[]): string {
  return [
    'The evidence below is ordered oldest to newest.',
    'Identify how this person is changing: which dimensions are rising, falling, or steady, and how fast.',
    'Only report shifts the evidence supports; return an empty list if there is too little to tell.',
    'Return ONLY JSON: {"shifts":[{"dimension","direction","velocity","evidenceIds"}]}',
    'direction is rising|falling|steady; velocity is slow|moderate|fast.',
    '',
    'EVIDENCE (chronological):',
    renderEvidence(evidence),
  ].join('\n');
}

export function typePrompt(evidence: EvidenceUnit[]): string {
  return [
    "Infer this person's cognitive type from the evidence below — four independent dichotomies, judged ONLY from how they actually write and reason (this is not a questionnaire; do not flatter).",
    'For each axis choose the dominant pole:',
    '- E vs I: outward, verbose, social, thinks-by-talking (E) vs inward, concise, reflective (I).',
    '- S vs N: concrete, literal, detail/present-focused (S) vs abstract, conceptual, pattern/possibility-focused (N).',
    '- T vs F: logic-first, impersonal, principle-driven (T) vs values-first, people-impact, harmony-driven (F).',
    '- J vs P: planful, structured, closure-seeking (J) vs open-ended, flexible, exploratory (P).',
    'For each axis output {letter, lean, evidenceIds}: letter is the chosen pole; lean is 50-100 (50 = barely leans, 100 = strongly); cite the evidence ids that justify it (or [] if weak).',
    'code = the four chosen letters in order E/I, S/N, T/F, J/P (e.g. "INTJ"). summary = two sentences, behavioral and specific, in your own words. confidence = low|medium|high overall.',
    'If the evidence is thin for an axis, keep lean near 50 and confidence low. Return ONLY JSON shaped exactly like:',
    '{"code":"INTJ","summary":"...","confidence":"medium","axes":{"EI":{"letter":"I","lean":70,"evidenceIds":["e1"]},"SN":{"letter":"N","lean":65,"evidenceIds":[]},"TF":{"letter":"T","lean":80,"evidenceIds":["e3"]},"JP":{"letter":"J","lean":60,"evidenceIds":[]}}}',
    '',
    'EVIDENCE:',
    renderEvidence(evidence),
  ].join('\n');
}
