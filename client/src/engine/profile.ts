import type { RawConversation } from '../capture/types';
import type { ModelCaller } from '../inference/types';
import { EvidenceUnit, Profile } from './types';
import { extractEvidence } from './evidence';
import { dedupeMoments, type PoolUnit } from './evidence-pool';
import { synthesize, type SynthesisDebug } from './synthesize';
import { computeCapability } from './capability';
import { assembleProfile } from './assemble';
import { FLUENCY_ONLY } from '../config';

export type Phase = { phase: 'evidence' | 'synthesis'; done: number; total: number };

export interface BuildProfileOpts {
  version: number;
  now: string;
  modelProvenance: string;
  fastModel?: string;
  bestModel?: string;
  maxChars?: number;
  maxChunks?: number;
  perConvoChars?: number;
  concurrency?: number;
  onPhase?: (p: Phase) => void;
  onSynthesisDebug?: (d: SynthesisDebug) => void;
  /** Override the product-wide FLUENCY_ONLY flag (tests exercise both modes). */
  fluencyOnly?: boolean;
  /**
   * Evidence pool from previous runs (already verified quotes). Merged with this run's freshly
   * extracted units before synthesis so scores accumulate ground truth instead of re-rolling it.
   */
  priorEvidence?: PoolUnit[];
  /**
   * Receives the merged, deduped, re-id'd evidence set the synthesis actually saw — the caller
   * persists it as the next run's priorEvidence. (The finished profile's evidence array is pruned
   * to cited units only, so it cannot serve as the pool.)
   */
  onEvidencePool?: (units: EvidenceUnit[]) => void;
  /**
   * The window the profile measures. With incremental extraction, `convos` holds only the
   * conversations that needed (re)scanning — the measured window is the caller's full selection,
   * so it must be passed explicitly or an unchanged re-run would report a 0-conversation window.
   */
  sourceWindow?: Profile['sourceWindow'];
}

// A run must never overwrite a good profile with a contentless one, and must fail LOUDLY when
// it produced nothing. What counts as "nothing" depends on the product mode: fluency-only means
// no capability (the personality fields are empty by design there — checking them caused every
// run to be discarded as empty after the fluency-only pivot); legacy means no content anywhere.
export function isEmptyProfile(
  p: Pick<Profile, 'thinking' | 'trajectory' | 'type' | 'capability'>,
  fluencyOnly = FLUENCY_ONLY,
): boolean {
  if (fluencyOnly) return !p.capability;
  return p.thinking.length === 0 && p.trajectory.shifts.length === 0 && !p.type && !p.capability;
}

export async function buildProfile(convos: RawConversation[], caller: ModelCaller, opts: BuildProfileOpts): Promise<Profile> {
  const fresh = await extractEvidence(convos, caller, {
    maxChars: opts.maxChars, maxChunks: opts.maxChunks, perConvoChars: opts.perConvoChars,
    model: opts.fastModel, concurrency: opts.concurrency,
    onProgress: (done, total) => opts.onPhase?.({ phase: 'evidence', done, total }),
  });

  // Union with the persistent pool from previous runs: dedupe by moment, restore chronological
  // order (the prompts promise oldest-to-newest), and reassign run-scoped ids over the whole set.
  // Fresh units come first into the dedupe so this run's (possibly longer) quote variant wins ties.
  const merged = dedupeMoments(
    [...fresh, ...(opts.priorEvidence ?? []).map((u) => ({ ...u, id: '' }))],
    (u) => u.sourceRef.conversationId,
  )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((u, i) => ({ ...u, id: `e${i + 1}` }));
  const evidence: EvidenceUnit[] = merged;
  opts.onEvidencePool?.(evidence);

  opts.onPhase?.({ phase: 'synthesis', done: 0, total: 1 });
  // Capability is a secondary lens computed off the same evidence; run it concurrently with
  // synthesis so it adds ~no wall-clock (it never throws — a failure resolves to null).
  // Fluency-only mode skips the personality synthesis entirely (one fewer model call);
  // assembleProfile and the schema tolerate the empty parts.
  const emptySynth = {
    thinking: [], trajectory: { window: { earlyTo: '', recentFrom: '' }, shifts: [] }, type: null,
  } as Awaited<ReturnType<typeof synthesize>>;
  const fluencyOnly = opts.fluencyOnly ?? FLUENCY_ONLY;
  const [{ thinking, trajectory, type: cogType }, capability] = await Promise.all([
    fluencyOnly ? Promise.resolve(emptySynth) : synthesize(evidence, caller, opts.bestModel, opts.onSynthesisDebug),
    computeCapability(evidence, caller, opts.bestModel),
  ]);
  opts.onPhase?.({ phase: 'synthesis', done: 1, total: 1 });

  // Anchoring, confidence grading, and evidence pruning are shared with the ChatGPT import path
  // (assembleProfile) so both providers meet the same credibility bar.
  const dates = convos.map((c) => c.createdAt).sort();
  return assembleProfile(
    { thinking, trajectory, type: cogType ?? undefined, capability: capability ?? undefined, evidence },
    {
      version: opts.version, now: opts.now, modelProvenance: opts.modelProvenance,
      sourceWindow: opts.sourceWindow
        ?? { fromDate: dates[0] ?? opts.now, toDate: dates[dates.length - 1] ?? opts.now, conversationCount: convos.length },
    },
  );
}
