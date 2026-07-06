import type { CaptureBundle } from './chatgpt-export';

// Shared building blocks so the single-message prompt (manual bridge) and the two-message autorun
// prompts stay in lockstep — the calibrated scoring rules live once, here.

const INPUT_SHAPE = '{"version":1,"instructionsFor":"aibadges-gpt","conversations":[{"conversationId":"c1","title":"...","createdAt":"<ISO date>","messages":[{"role":"user|assistant","text":"..."}]}]}';

const EVIDENCE_RULES = [
  'What counts as evidence:',
  '- Use only the person\'s own authentic, recurring, first-person behavior.',
  '- Make a claim only if a skeptic reading just the cited quotes would agree it follows. Prefer fewer, well-grounded claims over speculation. When evidence is thin, say less.',
  '- Exclude: text they pasted or quoted from elsewhere, requests made on behalf of others, role-play or fiction prompts, and instructions aimed at the model.',
  '- Heavily discount: one-off statements, sarcasm or jokes, hypotheticals, tests of the AI, venting.',
  '- Topic is not trait. Never infer sensitive attributes (health, sexuality, religion, politics, mental state) from what they asked about.',
].join('\n');

const EXTRACTION_STEP = 'extract a RICH, GRANULAR set of short behavioral evidence units: aim for 2-4 per substantive conversation and draw from as many different conversations as you can (for a full history this is dozens of units, not a handful). Each is a DISTINCT behavior with its own id (e1, e2, ...), the conversationId it came from (the c1/c2/... value in the input), a one-line summary, a short verbatim quote of the USER, and a type from exactly: decision, reasoning_move, episode, preference.';

const SYNTHESIS_STEPS = 'Write claims about how the person thinks (thinking) plus a few trajectory shifts (trajectory), each citing evidence ids. Optionally infer a four-letter behavioral type (Jungian dichotomies E/I, S/N, T/F, J/P) ONLY if the evidence clearly supports it; otherwise omit "type" entirely. Assess AI-working capability: score four AI-fluency dimensions, each a band emerging|developing|proficient|advanced, and for each cite the evidence ids whose quotes DEMONSTRATE that exact dimension. A skeptic reading only those quotes must agree the band is earned. Do NOT reuse the same quote across dimensions unless it genuinely evidences each, and never cite a quote that does not show that dimension. Score to the evidence actually present, not to a default: delegation = handing off whole, well-scoped tasks and choosing what to delegate (if the quotes show the person handing the model substantial self-contained jobs, e.g. "evaluate this opportunity end to end" or "produce a market study and business plan", that is proficient or advanced delegation, do not under-rate it); description = how clearly they prompt (goal, context, constraints, output format); discernment = catching errors, correcting, narrowing the frame, pushing back on weak answers; diligence = verifying before acting (asking for sources, checking, testing, iterating), the hardest to see in chat, so if the quotes do not actually show verification, score it emerging or developing and set its evidenceIds to only truly relevant quotes (or []), and do NOT pad it with unrelated asks. Use emerging/developing only when the evidence for that dimension is genuinely weak, not as a blanket cap. A band is earned by evidence weight: advanced needs several clear examples across different conversations, proficient at least a couple, and a single or ambiguous quote supports at most developing; when torn between two bands choose the LOWER and never inflate to reach a higher level. Place the person on a 1-8 fluency stage matching the strongest consistently-evidenced dimensions; chat caps the stage at 6 (reserve 7-8 only for explicit agent or tool orchestration). List only domains the evidence supports.';

const CITATION_RULE = 'Across the WHOLE output, cite a distinct evidence id for each claim and each dimension wherever the evidence allows; do not lean on the same few quotes, and never cite any single evidence id more than twice. If a behavior recurs, use additional distinct quotes for it rather than reusing one.';

const JSON_RULES = 'Return ONLY one JSON object inside a single ```json code block, with no text before or after. It must be strictly valid JSON: escape every double quote inside a string as \\", and put no markdown, links, or raw line breaks inside string values.';

const SCALE_NOTE = 'confidence and lean scale with how much evidence supports the item and across how many distinct conversations. lean is 50-100. Omit "type" if there is no clear signal. Output JSON only.';

// Output shape fragments (defined once so the single- and two-message shapes can't drift).
const SHAPE_THINKING = '"thinking":[{"claim":"...","evidenceIds":["e1"],"confidence":"low|medium|high"}]';
const SHAPE_TRAJ = '"trajectory":{"shifts":[{"dimension":"...","direction":"rising|falling|steady","velocity":"slow|moderate|fast","evidenceIds":["e1"]}]}';
const SHAPE_TYPE = '"type":{"code":"INTJ","summary":"...","confidence":"low|medium|high","axes":{"EI":{"letter":"I","lean":70,"evidenceIds":["e1"]},"SN":{"letter":"N","lean":60,"evidenceIds":[]},"TF":{"letter":"T","lean":75,"evidenceIds":[]},"JP":{"letter":"J","lean":60,"evidenceIds":[]}}}';
const SHAPE_CAP = '"capability":{"aiFluency":{"delegation":{"band":"proficient","evidenceIds":["e1"]},"description":{"band":"advanced","evidenceIds":[]},"discernment":{"band":"developing","evidenceIds":[]},"diligence":{"band":"developing","evidenceIds":[]}},"yeggeStage":{"stage":5,"evidenceIds":[]},"domains":[{"name":"...","band":"proficient","evidenceIds":[]}]}';
const SHAPE_EVIDENCE = '"evidence":[{"id":"e1","conversationId":"c1","quote":"...","summary":"...","type":"decision|reasoning_move|episode|preference"}]';

const SYNTH_SHAPE = `{${SHAPE_THINKING},\n ${SHAPE_TRAJ},\n ${SHAPE_TYPE},\n ${SHAPE_CAP}}`;
const FULL_SHAPE = `{${SHAPE_THINKING},\n ${SHAPE_TRAJ},\n ${SHAPE_TYPE},\n ${SHAPE_CAP},\n ${SHAPE_EVIDENCE}}`;

// Single message (manual bridge fallback): full profile + evidence in one reply.
export const BRIDGE_INSTRUCTIONS = [
  'You are AIBadges. Below is one JSON object describing a person\'s own ChatGPT history, with this shape:',
  INPUT_SHAPE, '',
  'Produce an honest, evidence-grounded behavioral profile of this person, judged only from what they actually wrote. Be a critical mirror, not flattering. Never invent.', '',
  EVIDENCE_RULES, '',
  `Steps: (1) ${EXTRACTION_STEP} (2) ${SYNTHESIS_STEPS} ${CITATION_RULE}`, '',
  `${JSON_RULES} Use exactly this shape:`,
  FULL_SHAPE, '',
  SCALE_NOTE,
].join('\n');

export function buildBridgePrompt(bundle: CaptureBundle): string {
  return `${BRIDGE_INSTRUCTIONS}\n\nINPUT:\n${JSON.stringify(bundle.export)}`;
}

// Two-message flow (invisible autorun). Step 1 mines a large evidence set; step 2 synthesizes from it
// in the SAME conversation. Splitting the work lets the model extract far more evidence than a single
// combined reply (which starves itself into reusing a few quotes) and keeps each reply short enough to
// avoid output truncation on long histories.
export function buildExtractionPrompt(bundle: CaptureBundle): string {
  return [
    'You are AIBadges (step 1 of 2: EVIDENCE EXTRACTION). Below is one JSON object describing a person\'s own ChatGPT history, with this shape:',
    INPUT_SHAPE, '',
    `From what the person actually wrote, ${EXTRACTION_STEP} Be a critical mirror, never invent.`, '',
    EVIDENCE_RULES, '',
    `${JSON_RULES} Use exactly this shape:`,
    `{${SHAPE_EVIDENCE}}`, '',
    'INPUT:',
    JSON.stringify(bundle.export),
  ].join('\n');
}

export const SYNTHESIS_PROMPT = [
  'Step 2 of 2: SYNTHESIS. Using ONLY the evidence units you just extracted (their e1, e2, ... ids), build the profile. Every scored item cites evidence ids.',
  SYNTHESIS_STEPS, '', CITATION_RULE, '',
  `${JSON_RULES} Do NOT repeat the evidence array. Use exactly this shape:`,
  SYNTH_SHAPE, '',
  SCALE_NOTE,
].join('\n');

export function buildSynthesisPrompt(): string { return SYNTHESIS_PROMPT; }
