import type { ModelCaller } from '../inference/types';
import { Capability, CapabilitySchema, EvidenceUnit } from './types';
import { parseJsonResponse } from './json';
import { capabilityPrompt } from '../prompts';

const CAPABILITY_TIMEOUT_MS = 130000;

type Attempt =
  | { kind: 'ok'; value: Capability }
  | { kind: 'parse'; error: string }
  | { kind: 'hard'; error: unknown };

async function attempt(evidence: EvidenceUnit[], caller: ModelCaller, model?: string): Promise<Attempt> {
  let raw: string;
  try { raw = await caller.complete(capabilityPrompt(evidence), { model, timeoutMs: CAPABILITY_TIMEOUT_MS }); }
  catch (e) { return { kind: 'hard', error: e }; }
  let obj: unknown;
  try { obj = parseJsonResponse(raw); } catch (e) { return { kind: 'parse', error: String(e) }; }
  const parsed = CapabilitySchema.safeParse(obj);
  if (!parsed.success) return { kind: 'parse', error: String(parsed.error) };
  return { kind: 'ok', value: parsed.data };
}

/**
 * Capability is a secondary lens: any hard call error, or an unparseable response after one
 * retry, must never throw and kill the run — log and return null so the rest of the profile
 * still assembles.
 */
export async function computeCapability(
  evidence: EvidenceUnit[], caller: ModelCaller, model?: string,
): Promise<Capability | null> {
  let lastErr = 'no attempt made';
  for (let n = 1; n <= 2; n++) {
    const r = await attempt(evidence, caller, model);
    if (r.kind === 'ok') return r.value;
    if (r.kind === 'hard') {
      console.warn('[aibadges] capability: call failed —', String(r.error));
      return null;
    }
    lastErr = r.error;
  }
  console.warn('[aibadges] capability: output failed to parse after 2 attempts:', lastErr);
  return null;
}
