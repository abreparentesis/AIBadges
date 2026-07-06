import type { RawConversation } from '../capture/types';
import type { EvidenceUnit } from '../engine/types';

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
    'dimensions unless it genuinely evidences each, and never cite a quote that does not show the dimension.',
    '- delegation: handing off whole, well-scoped tasks and choosing what to delegate. If the quotes show the person',
    '  handing the model substantial self-contained jobs (e.g. "evaluate this opportunity end to end", "produce a',
    '  market study and business plan"), that is proficient or advanced delegation — do not under-rate it.',
    '- description: how clearly they prompt — goal, context, constraints, output format.',
    '- discernment: catching errors, correcting, narrowing the frame, pushing back on weak or generic answers.',
    '- diligence: verifying before acting (asking for sources, checking, testing, iterating). Hardest to see in chat;',
    '  if the quotes do not actually show verification, score it emerging/developing with only truly relevant',
    '  evidenceIds (or []) — do NOT pad it with unrelated asks to make it look backed.',
    'Use emerging/developing only when the evidence for that dimension is genuinely weak, not as a blanket cap.',
    'A band is earned by evidence weight: advanced needs several clear examples across different conversations,',
    'proficient at least a couple, and a single or ambiguous quote supports at most developing. When torn between',
    'two bands, choose the LOWER, and never inflate to reach a higher level.',
    '',
    'Place them on a 1-8 AI-fluency stage (Explorer 1-2, Operator 3-4, Practitioner 5-6, Orchestrator 7-8) matching the',
    'strongest consistently-evidenced dimensions.',
    'Stages 7-8 describe orchestrating autonomous agents and tools across multi-step work — behavior a chat transcript',
    'essentially cannot show. From chat evidence alone, CAP the stage at 6; assign 7-8 ONLY if the evidence explicitly',
    'shows the person running or directing agents/tool workflows.',
    '',
    'List only domains the evidence actually supports. Each scored item cites evidence ids. Return ONLY JSON shaped exactly like:',
    '{"aiFluency":{"delegation":{"band":..,"evidenceIds":[..]},"description":{..},"discernment":{..},"diligence":{..}},',
    '"yeggeStage":{"stage":N,"evidenceIds":[..]},"domains":[{"name":..,"band":..,"evidenceIds":[..]}]}',
    '',
    'EVIDENCE:',
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
