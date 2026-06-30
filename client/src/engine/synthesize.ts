import type { ModelCaller } from '../inference/types';
import { Claim, ClaimSchema, Trajectory, TrajectoryShiftSchema, CognitiveType, CognitiveTypeSchema, EvidenceUnit } from './types';
import { parseJsonResponse } from './json';
import { synthesisPrompt } from '../prompts';
import { z } from 'zod';

const SYNTHESIS_TIMEOUT_MS = 130000;

export interface Synthesis {
  thinking: Claim[];
  trajectory: Trajectory;
  type: CognitiveType | null;
}

export interface SynthesisDebug {
  rawText: string;
  parsedOk: boolean;
  attempts: number;
  parts?: { thinking: boolean; trajectory: boolean; type: boolean };
  error?: string;
}

function trajectoryWindow(evidence: EvidenceUnit[]): { earlyTo: string; recentFrom: string } {
  if (evidence.length === 0) return { earlyTo: '', recentFrom: '' };
  const sorted = [...evidence].sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));
  const mid = Math.floor((sorted.length - 1) / 2);
  return { earlyTo: sorted[mid].timestamp, recentFrom: sorted[Math.min(mid + 1, sorted.length - 1)].timestamp };
}

type Parts = { thinking: boolean; trajectory: boolean; type: boolean };
type Attempt =
  | { kind: 'ok'; value: Synthesis; raw: string; parts: Parts }
  | { kind: 'parse'; error: string; raw: string }
  | { kind: 'hard'; error: unknown };

function extract(raw: string, window: { earlyTo: string; recentFrom: string }): Attempt {
  let obj: any;
  try { obj = parseJsonResponse(raw); } catch (e) { return { kind: 'parse', error: String(e), raw }; }
  const thinkingP = z.array(ClaimSchema).safeParse(obj?.thinking);
  const shiftsP = z.array(TrajectoryShiftSchema).safeParse(obj?.trajectory?.shifts ?? []);
  const typeP = CognitiveTypeSchema.safeParse(obj?.type);
  const parts = { thinking: thinkingP.success, trajectory: shiftsP.success, type: typeP.success };
  if (!parts.thinking && !parts.trajectory) return { kind: 'parse', error: 'no part validated', raw };
  return {
    kind: 'ok', raw, parts,
    value: {
      thinking: thinkingP.success ? thinkingP.data : [],
      trajectory: { window, shifts: shiftsP.success ? shiftsP.data : [] },
      type: typeP.success ? typeP.data : null,
    },
  };
}

async function attempt(evidence: EvidenceUnit[], caller: ModelCaller, model?: string): Promise<Attempt> {
  let raw: string;
  try { raw = await caller.complete(synthesisPrompt(evidence), { model, timeoutMs: SYNTHESIS_TIMEOUT_MS }); }
  catch (e) { return { kind: 'hard', error: e }; }
  return extract(raw, trajectoryWindow(evidence));
}

/**
 * One combined completion for all three lenses. HTTP failures (after the caller's backoff) are
 * propagated so the run is not saved as an empty profile; a fully unparseable response gets one retry.
 */
export async function synthesize(
  evidence: EvidenceUnit[], caller: ModelCaller, model?: string, debug?: (d: SynthesisDebug) => void,
): Promise<Synthesis> {
  const fallback: Synthesis = { thinking: [], trajectory: { window: trajectoryWindow(evidence), shifts: [] }, type: null };
  let lastRaw = ''; let lastErr = 'no attempt made';
  for (let n = 1; n <= 2; n++) {
    const r = await attempt(evidence, caller, model);
    if (r.kind === 'ok') { debug?.({ rawText: r.raw, parsedOk: true, attempts: n, parts: r.parts }); return r.value; }
    if (r.kind === 'hard') {
      console.warn('[aibadges] synthesis: call failed —', String(r.error));
      debug?.({ rawText: '', parsedOk: false, attempts: n, error: String(r.error) });
      throw r.error;
    }
    lastRaw = r.raw; lastErr = r.error;
  }
  console.warn('[aibadges] synthesis: output failed to parse after 2 attempts:', lastErr);
  debug?.({ rawText: lastRaw, parsedOk: false, attempts: 2, error: lastErr });
  return fallback;
}
