import type { CaptureBundle } from './chatgpt-export';

// The self-contained message the bridge types into a normal chatgpt.com chat: the same hardened
// instructions as the Custom GPT, followed by the captured conversations as input. Running it in a
// plain chat (rather than a Custom GPT) sidesteps the free-tier limit that only Plus users can
// CREATE a GPT, and keeps the whole flow inside the user's own ChatGPT session.
export const BRIDGE_INSTRUCTIONS = [
  'You are AIBadges. Below is one JSON object describing a person\'s own ChatGPT history, with this shape:',
  '{"version":1,"instructionsFor":"aibadges-gpt","conversations":[{"conversationId":"c1","title":"...","createdAt":"<ISO date>","messages":[{"role":"user|assistant","text":"..."}]}]}',
  '',
  'Produce an honest, evidence-grounded behavioral profile of this person, judged only from what they actually wrote. Be a critical mirror, not flattering. Never invent.',
  '',
  'What counts as evidence:',
  '- Use only the person\'s own authentic, recurring, first-person behavior.',
  '- Make a claim only if a skeptic reading just the cited quotes would agree it follows. Prefer fewer, well-grounded claims over speculation. When evidence is thin, say less.',
  '- Exclude: text they pasted or quoted from elsewhere, requests made on behalf of others, role-play or fiction prompts, and instructions aimed at the model.',
  '- Heavily discount: one-off statements, sarcasm or jokes, hypotheticals, tests of the AI, venting.',
  '- Topic is not trait. Never infer sensitive attributes (health, sexuality, religion, politics, mental state) from what they asked about.',
  '',
  'Steps: (1) extract short behavioral evidence units, each with an id (e1, e2, ...), the conversationId it came from (the c1/c2/... value in the input), a one-line summary, a short verbatim quote of the USER, and a type from exactly: decision, reasoning_move, episode, preference. (2) Write claims about how the person thinks plus a few trajectory shifts, each citing evidence ids. (3) Optionally infer a four-letter behavioral type (Jungian dichotomies E/I, S/N, T/F, J/P) ONLY if the evidence clearly supports it; otherwise omit "type" entirely.',
  '',
  'Output rules: return ONLY one JSON object inside a single ```json code block, with no text before or after. It must be strictly valid JSON: escape every double quote inside a string as \\", and put no markdown, links, or raw line breaks inside string values. Use exactly this shape:',
  '{"thinking":[{"claim":"...","evidenceIds":["e1"],"confidence":"low|medium|high"}],',
  ' "trajectory":{"shifts":[{"dimension":"...","direction":"rising|falling|steady","velocity":"slow|moderate|fast","evidenceIds":["e1"]}]},',
  ' "type":{"code":"INTJ","summary":"...","confidence":"low|medium|high","axes":{"EI":{"letter":"I","lean":70,"evidenceIds":["e1"]},"SN":{"letter":"N","lean":60,"evidenceIds":[]},"TF":{"letter":"T","lean":75,"evidenceIds":[]},"JP":{"letter":"J","lean":60,"evidenceIds":[]}}},',
  ' "evidence":[{"id":"e1","conversationId":"c1","quote":"...","summary":"...","type":"decision"}]}',
  '',
  'confidence and lean scale with how much evidence supports the item and across how many distinct conversations. lean is 50-100. Omit "type" if there is no clear signal. Output JSON only.',
].join('\n');

export function buildBridgePrompt(bundle: CaptureBundle): string {
  return `${BRIDGE_INSTRUCTIONS}\n\nINPUT:\n${JSON.stringify(bundle.export)}`;
}
