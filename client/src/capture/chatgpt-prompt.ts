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

const EXTRACTION_STEP = 'extract a RICH, GRANULAR set of short behavioral evidence units: aim for 2-4 per substantive conversation and draw from as many different conversations as you can (for a full history this is dozens of units, not a handful). Each is a DISTINCT behavior with its own id (e1, e2, ...), the conversationId it came from (the c1/c2/... value in the input), a one-line summary, a short verbatim quote of the USER, and a type from exactly: decision, reasoning_move, episode, preference. Especially capture moments where the person REACTS to the model — correcting it, disagreeing, rejecting or redoing a weak answer, or verifying/checking a claim — not only their requests; these reactions are the clearest capability signal and are easy to miss. Note that a quote which merely supplies a fact or context to the model (a date, a price, a relationship, which company to look at) is a weak signal — capture it if distinctive, but it evidences at most how they prompt.';

const SYNTHESIS_STEPS = [
  'Write claims about how the person thinks (thinking) plus a few trajectory shifts (trajectory), each citing evidence ids. Optionally infer a four-letter behavioral type (Jungian dichotomies E/I, S/N, T/F, J/P) ONLY if the evidence clearly supports it; otherwise omit "type" entirely.',
  'Assess AI-working capability: score four AI-fluency dimensions, each a band emerging|developing|proficient|advanced, and for each cite the evidence ids whose quotes DEMONSTRATE that exact dimension. A skeptic reading only those quotes must agree the band is earned.',
  'CRITICAL: every fluency measures how the person ENGAGES THE AI, not the topic they discussed or facts they happened to share. Supplying information the model could not have known — a wine\'s vintage ("el triay es cosecha 2021"), that a flat is co-owned with a spouse ("el piso está al 50% con mi mujer"), which company to look into, a date or price — is ordinary context-giving: it counts at most toward description, and NEVER toward discernment, diligence, or delegation. A quote earns a dimension only if, read entirely on its own, it shows that dimension\'s specific action; if the same sentence would read identically in a message to a human who had given no prior answer, it is neither discernment nor diligence. Do NOT reuse a quote across dimensions unless it genuinely evidences each.',
  'Score to the evidence actually present, not to a default:',
  '- delegation = handing off whole, well-scoped tasks. Handing the model substantial self-contained jobs (e.g. "evaluate this opportunity end to end", "produce a market study and business plan") is proficient or advanced — do not under-rate it. Merely naming a task\'s subject is not delegation. A chat rarely shows the deliberate CHOICE of what to delegate; credit that only when the person explicitly says what they keep vs hand off — otherwise score only the hand-offs actually present.',
  '- description = how clearly they prompt: an explicit goal, constraints, and often a requested output format. This is the ONLY dimension where ordinary context-giving belongs, but advanced description shows real structure — a clear goal with genuine constraints, usually a requested output format — not sheer volume; raw context dumps with no stated goal or constraints are at most developing.',
  '- discernment = the person REACTING TO the model\'s output: correcting it, disagreeing, rejecting or redoing a weak answer, catching an error, narrowing an over-broad reply. The quote must show a judgment of what the AI produced. Stating one\'s own facts, opinions, or preferences is NOT discernment.',
  '- diligence = verifying what the AI GAVE before acting on it: checking or challenging its sources or answer, cross-checking a claim it made, testing its output, or iterating to fix a flaw it produced. Hardest to see in chat, and a first-message request for sources or ordinary re-prompting is NOT diligence (it would read the same to a human given no prior answer). If the quotes do not actually show verification of the model\'s output, score it emerging or developing and cite only truly relevant quotes (or []); do not pad it.',
  'Score each band from the OVERALL PATTERN across the whole history, NOT the number of quotes. Ladder: emerging = essentially no sign of the skill; developing = only occasional or shallow instances (rejecting a suggestion, refining a request, a one-line fix), even if there are several; proficient = a regular, substantive pattern across different conversations; advanced = a defining, SOPHISTICATED pattern that recurs (for discernment, e.g., catching subtle errors, challenging the model\'s reasoning, or re-framing its approach — never a handful of shallow reactions). A few lousy, short, or ambiguous quotes NEVER earn proficient or advanced, however many there are; when torn choose the LOWER.',
  'For EACH dimension also write a one-sentence "note": the actual recurring pattern that earns the band, in plain terms (e.g. "regularly challenges the model\'s reasoning and asks it to redo weak answers"). The band MUST match the note — if you cannot describe a genuinely sophisticated, recurring pattern, it is not advanced; if you cannot describe a real pattern at all, it is emerging or developing.',
  'SELF-AUDIT before you output aiFluency, in two passes. (1) Per quote: delete every cited quote that, read alone, does not show that dimension\'s specific engagement with the AI — for discernment/diligence the quote MUST point to something the AI said or produced (if you cannot name the AI output it reacts to or checks, delete it); for delegation it MUST contain the actual handed-off task, not its topic. (2) Holistic: step back and look at the SURVIVING quotes as a whole — if the pattern is shallow, sparse, or ambiguous, LOWER the band and rewrite the note to match. Advanced and proficient must be earned by the pattern, not by the count.',
  'Fill yeggeStage too, but keep it light: the overall stage is recomputed from your four bands afterward, so just give your rough 1-6 read (chat cannot evidence the 7-8 tier, which is orchestrating autonomous agents and tools). List only domains the evidence supports.',
].join('\n');

const CITATION_RULE = 'Across the WHOLE output, cite a distinct evidence id for each claim and each dimension wherever the evidence allows; do not lean on the same few quotes, and never cite any single evidence id more than twice. If a behavior recurs, use additional distinct quotes for it rather than reusing one.';

const JSON_RULES = 'Return ONLY one JSON object inside a single ```json code block, with no text before or after. It must be strictly valid JSON: escape every double quote inside a string as \\", and put no markdown, links, or raw line breaks inside string values.';

const SCALE_NOTE = 'lean is 50-100 and should track how strongly the evidence leans, near 50 when thin. Omit "type" if there is no clear signal. Output JSON only.';

// Output shape fragments (defined once so the single- and two-message shapes can't drift).
const SHAPE_THINKING = '"thinking":[{"claim":"...","evidenceIds":["e1"],"confidence":"low|medium|high"}]';
const SHAPE_TRAJ = '"trajectory":{"shifts":[{"dimension":"...","direction":"rising|falling|steady","velocity":"slow|moderate|fast","evidenceIds":["e1"]}]}';
const SHAPE_TYPE = '"type":{"code":"INTJ","summary":"...","confidence":"low|medium|high","axes":{"EI":{"letter":"I","lean":70,"evidenceIds":["e1"]},"SN":{"letter":"N","lean":60,"evidenceIds":[]},"TF":{"letter":"T","lean":75,"evidenceIds":[]},"JP":{"letter":"J","lean":60,"evidenceIds":[]}}}';
const SHAPE_CAP = '"capability":{"aiFluency":{"delegation":{"band":"proficient","note":"one-sentence pattern that earns this band","evidenceIds":["e1"]},"description":{"band":"advanced","note":"...","evidenceIds":[]},"discernment":{"band":"developing","note":"...","evidenceIds":[]},"diligence":{"band":"developing","note":"...","evidenceIds":[]}},"yeggeStage":{"stage":5,"evidenceIds":[]},"domains":[{"name":"...","band":"proficient","evidenceIds":[]}]}';
const SHAPE_EVIDENCE = '"evidence":[{"id":"e1","conversationId":"c1","quote":"...","summary":"...","type":"decision|reasoning_move|episode|preference"}]';

const SYNTH_SHAPE = `{${SHAPE_THINKING},\n ${SHAPE_TRAJ},\n ${SHAPE_TYPE},\n ${SHAPE_CAP}}`;
const FULL_SHAPE = `{${SHAPE_THINKING},\n ${SHAPE_TRAJ},\n ${SHAPE_TYPE},\n ${SHAPE_CAP},\n ${SHAPE_EVIDENCE}}`;

// Single message (manual bridge fallback): full profile + evidence in one reply.
export const BRIDGE_INSTRUCTIONS = [
  'You are AI Fluency Index. Below is one JSON object describing a person\'s own ChatGPT history, with this shape:',
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

// Three-message flow (invisible autorun): step 1 mines a large evidence set, step 2 synthesizes the
// profile from it, step 3 adversarially audits the fluency bands — all in the SAME conversation.
// Splitting the work lets the model extract far more evidence than a single combined reply (which
// starves itself into reusing a few quotes) and keeps each reply short enough to avoid truncation.
export function buildExtractionPrompt(bundle: CaptureBundle): string {
  return [
    'You are AI Fluency Index (step 1 of 3: EVIDENCE EXTRACTION). Below is one JSON object describing a person\'s own ChatGPT history, with this shape:',
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
  'Step 2 of 3: SYNTHESIS. Using ONLY the evidence units you just extracted (their e1, e2, ... ids), build the profile. Every scored item cites evidence ids.',
  SYNTHESIS_STEPS, '', CITATION_RULE, '',
  `${JSON_RULES} Do NOT repeat the evidence array. Use exactly this shape:`,
  SYNTH_SHAPE, '',
  SCALE_NOTE,
].join('\n');

export function buildSynthesisPrompt(): string { return SYNTHESIS_PROMPT; }

// Batched (map-reduce) synthesis. When the history is captured across several extraction batches, the
// evidence is pooled CLIENT-side into one id-stable set and embedded here, so the model synthesizes
// from the full pool with citations that can't drift across batches (rather than relying on it to
// remember many earlier messages). Mirrors the Claude path, which also embeds its evidence.
export interface PooledEvidence { id: string; conversationId: string; quote: string; summary?: string }
function renderPooled(units: PooledEvidence[]): string {
  return units.map((u) => `- ${u.id} (${u.conversationId}): "${u.quote}"${u.summary ? ` — ${u.summary}` : ''}`).join('\n');
}
export function buildSynthesisFromEvidence(units: PooledEvidence[]): string {
  return [
    'Step 2 of 3: SYNTHESIS. Below is the FULL set of evidence units extracted from this person\'s history (id, conversationId, quote). Use ONLY these ids; every scored item cites them.',
    SYNTHESIS_STEPS, '', CITATION_RULE, '',
    `${JSON_RULES} Do NOT repeat the evidence array. Use exactly this shape:`,
    SYNTH_SHAPE, '',
    SCALE_NOTE, '',
    'EVIDENCE:',
    renderPooled(units),
  ].join('\n');
}

// Step 3: an ADVERSARIAL audit of just the four fluency bands. A separate turn (not the inline
// self-audit inside synthesis) because one combined reply reliably keeps quotes that don't earn their
// band — an information question scored as delegation, a terse context fragment scored as advanced
// description. This turn does nothing but try to REJECT unearned bands, with the concrete failure
// modes named, then re-bands from what survives. The code re-caps by evidence count on top of this.
const AUDIT_RULES = [
  'Audit the four AI-fluency dimensions you just scored, as a hostile skeptic whose only job is to REJECT any band its quotes do not earn. Re-read the quotes behind each dimension and DELETE from that dimension every evidence id whose quote, read alone, does not genuinely demonstrate it:',
  '- delegation: keep only a handed-off, self-contained TASK ("evaluate this opportunity end to end", "produce a comparative table on X"). DELETE plain information questions ("how is the forensic-medicine postgrad at X?", "what is the real parking demand at X?") — asking for a fact is not delegating a task.',
  '- description: keep only real prompt structure (a goal WITH constraints, often a requested output format). DELETE terse context fragments and ordinary one-line questions ("Private, with monthly rent", "24h - no security", "in Spanish") — supplying a fact or answering the AI\'s clarifying question is not advanced prompting.',
  '- discernment: keep only quotes that REACT TO the AI\'s output (correct it, reject it, narrow it, catch an error). DELETE the person\'s own facts, opinions, preferences, or fresh questions.',
  '- diligence: keep only quotes that verify what the AI GAVE (challenge a source it cited, cross-check a claim it made, test its output). DELETE fresh factual questions and one-word asks ("Validate", "does income tax rise with income?").',
  'Then RE-BAND each dimension from the OVERALL PATTERN of what survives, not the count: step back and judge the surviving quotes as a whole. A few shallow, short, or ambiguous quotes are developing at most — advanced and proficient require a genuinely SOPHISTICATED, recurring pattern (e.g. discernment: catching subtle errors or challenging the model\'s reasoning, not merely rejecting a suggestion or refining a request). When in doubt choose the LOWER band. For each dimension write a one-sentence "note" stating the pattern that earns the band; the band MUST match the note.',
  'FINALLY, compare the four dimensions against EACH OTHER and force them apart. People are rarely equally strong at all four — one or two are clearly their strongest. If you have marked three or four as "advanced", you are almost certainly over-rating: keep advanced ONLY for the dimension(s) with the most sophisticated, substantive evidence and lower the rest by at least one band. Be hardest on discernment and diligence — shallow reactions ("rejecting a suggestion", "redo it", a one-line correction, banter) are NOT advanced; advanced discernment is sustained, sophisticated critique of the model\'s reasoning. Audit domains the same way.',
].join('\n');
const AUDIT_SHAPE = '{"aiFluency":{"delegation":{"band":"emerging|developing|proficient|advanced","note":"pattern that earns this band","evidenceIds":["e1"]},"description":{...},"discernment":{...},"diligence":{...}},"domains":[{"name":"...","band":"...","evidenceIds":["e1"]}]}';

export const AUDIT_PROMPT = [
  'Step 3 of 3: EVIDENCE AUDIT.',
  AUDIT_RULES, '',
  `${JSON_RULES} Reuse the same evidence ids you already extracted (never invent new ones), and return ONLY the corrected capability object — no thinking/type/evidence. Use exactly this shape:`,
  AUDIT_SHAPE,
].join('\n');

export function buildAuditPrompt(): string { return AUDIT_PROMPT; }
