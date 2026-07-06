import { z } from "zod";
import { isValidValue } from "../engine/codebook";
import type { CodeType, Profile } from "../engine/types";
import type { Turn } from "../ingest/parse";
import type { LlmClient } from "./client";
import { chunkUserPrompt, codingSystemPrompt } from "./prompts";

export interface CodeSuggestion {
  type: CodeType;
  value: string;
  quote: string;
  turnRef: number;
  confidence: number;
}

const suggestionSchema = z.object({
  type: z.enum(["PAIN", "SPEND", "ALT", "BUYER", "PRIV_PRE", "PRIV_POST", "PARTIC", "COMMIT"]),
  value: z.string(),
  quote: z.string().min(3),
  turnRef: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});
const responseSchema = z.object({ codes: z.array(suggestionSchema) });

const DEFAULT_MAX_CHARS = 8000;
const OVERLAP_TURNS = 2;

export function chunkTurns(turns: Turn[], maxChars = DEFAULT_MAX_CHARS): Turn[][] {
  const chunks: Turn[][] = [];
  let current: Turn[] = [];
  let size = 0;
  for (const t of turns) {
    const len = t.text.length + t.speaker.length + 8;
    if (current.length > 0 && size + len > maxChars) {
      chunks.push(current);
      current = current.slice(-OVERLAP_TURNS);
      size = current.reduce((s, x) => s + x.text.length + x.speaker.length + 8, 0);
    }
    current.push(t);
    size += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Validate one parsed suggestion against the chunk: value must be legal for
 * the type, turnRef must exist in the chunk, and the quote must be a
 * verbatim substring of that turn (hallucinated evidence is rejected).
 */
function validateAgainstChunk(s: CodeSuggestion, chunk: Turn[]): string | null {
  if (!isValidValue(s.type, s.value)) return `invalid value '${s.value}' for ${s.type}`;
  const turn = chunk.find((t) => t.i === s.turnRef);
  if (!turn) return `turnRef ${s.turnRef} not in chunk`;
  if (!turn.text.includes(s.quote)) return `quote is not a verbatim substring of turn ${s.turnRef}`;
  return null;
}

function parseAndValidate(
  raw: string,
  chunk: Turn[],
): { ok: true; suggestions: CodeSuggestion[] } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["response is not valid JSON"] };
  }
  const res = responseSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const errors: string[] = [];
  const good: CodeSuggestion[] = [];
  for (const s of res.data.codes) {
    const err = validateAgainstChunk(s, chunk);
    if (err) errors.push(err);
    else good.push(s);
  }
  // Partial rejection is fine — but if EVERYTHING failed validation, treat as an error round.
  if (good.length === 0 && res.data.codes.length > 0) return { ok: false, errors };
  return { ok: true, suggestions: good };
}

export async function codeTranscript(
  turns: Turn[],
  profile: Profile,
  client: LlmClient,
): Promise<{ suggestions: CodeSuggestion[]; failedChunks: number[] }> {
  const system = codingSystemPrompt(profile);
  const chunks = chunkTurns(turns);
  const all: CodeSuggestion[] = [];
  const failedChunks: number[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const user = chunkUserPrompt(chunk);
    let outcome = await tryOnce(client, system, user, chunk);
    if (!outcome.ok) {
      const retryUser = `${user}\n\nYour previous response was invalid:\n- ${outcome.errors.join("\n- ")}\nFix these issues and return the JSON again.`;
      outcome = await tryOnce(client, system, retryUser, chunk);
    }
    if (outcome.ok) all.push(...outcome.suggestions);
    else failedChunks.push(ci);
  }

  // dedupe on (type,value,quote) — overlapping turns can double-code
  const seen = new Set<string>();
  const suggestions = all.filter((s) => {
    const k = `${s.type}|${s.value}|${s.quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { suggestions, failedChunks };
}

async function tryOnce(
  client: LlmClient,
  system: string,
  user: string,
  chunk: Turn[],
): Promise<{ ok: true; suggestions: CodeSuggestion[] } | { ok: false; errors: string[] }> {
  let raw: string;
  try {
    raw = await client.complete({ system, user, json: true });
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
  return parseAndValidate(raw, chunk);
}
