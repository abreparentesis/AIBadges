import { CODEBOOK } from "../engine/codebook";
import { PROFILE_LABELS } from "../engine/kit";
import type { Profile } from "../engine/types";
import type { Turn } from "../ingest/parse";

export function codebookText(profile: Profile): string {
  return CODEBOOK.map((d) => {
    const anchor = d.anchors?.[profile] ? `\n  Severity anchors for this segment: ${d.anchors[profile]}` : "";
    return `- ${d.type} (allowed values: ${d.values.join(", ")}): ${d.description}${anchor}`;
  }).join("\n");
}

export const FEW_SHOT = `Examples of correct output items:
{"type":"PAIN","value":"3","quote":"Our CFO asked exactly that in March. We had nothing.","turnRef":4,"confidence":0.85}
{"type":"COMMIT","value":"3","quote":"we'd pay for a pilot if the data looks real","turnRef":6,"confidence":0.8}
Counter-example (WRONG, do not emit): a COMMIT-3 for "sounds great, keep me posted" — that is a rejection, not a commitment. Polite enthusiasm and compliments are never evidence.`;

export function codingSystemPrompt(profile: Profile): string {
  return `You code customer-discovery interview transcripts against a fixed codebook, for the segment "${PROFILE_LABELS[profile]}" (profile ${profile}).

Codebook:
${codebookText(profile)}

Rules:
- Output STRICT JSON: {"codes": [{"type": "...", "value": "...", "quote": "...", "turnRef": <number>, "confidence": <0..1>}]}
- "quote" MUST be a verbatim substring of the turn at index "turnRef" — copy characters exactly, never paraphrase.
- Only code what the interviewee actually said happened (past, specific). Hypotheticals, compliments, and interviewer speech are never coded.
- BUYER value is the named budget-owner role in lowercase, or "TRIANGLE" when a competing owner is named.
- Emit at most one PAIN, PRIV_PRE, PRIV_POST, PARTIC per chunk; COMMIT for the highest rung evidenced.
- If nothing in the chunk warrants a code, return {"codes": []}.

${FEW_SHOT}`;
}

export function chunkUserPrompt(turns: Turn[]): string {
  const lines = turns
    .map((t) => `[${t.i}] ${t.speaker}: ${t.text}`)
    .join("\n");
  return `Transcript chunk (turn index in brackets):\n${lines}\n\nReturn the JSON now.`;
}

export function prosePrompt(section: string, factsJson: string): string {
  return `You draft the prose for the "${section}" section of a customer-discovery synthesis report.

Facts (authoritative — reproduce every number EXACTLY as given, never recompute, round, or omit):
${factsJson}

Write 2-4 short paragraphs of plain, direct prose summarizing what the facts show. No headers, no bullet lists, no recommendations beyond what the verdict states. British understatement over hype.`;
}
