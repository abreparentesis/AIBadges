import type { RawConversation } from '../capture/types';
import type { ModelCaller } from '../inference/types';
import { Profile } from './types';
import { extractEvidence } from './evidence';
import { synthesize, type SynthesisDebug } from './synthesize';
import { computeCapability } from './capability';
import { assembleProfile } from './assemble';

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
}

export async function buildProfile(convos: RawConversation[], caller: ModelCaller, opts: BuildProfileOpts): Promise<Profile> {
  const evidence = await extractEvidence(convos, caller, {
    maxChars: opts.maxChars, maxChunks: opts.maxChunks, perConvoChars: opts.perConvoChars,
    model: opts.fastModel, concurrency: opts.concurrency,
    onProgress: (done, total) => opts.onPhase?.({ phase: 'evidence', done, total }),
  });

  opts.onPhase?.({ phase: 'synthesis', done: 0, total: 1 });
  // Capability is a secondary lens computed off the same evidence; run it concurrently with
  // synthesis so it adds ~no wall-clock (it never throws — a failure resolves to null).
  const [{ thinking, trajectory, type: cogType }, capability] = await Promise.all([
    synthesize(evidence, caller, opts.bestModel, opts.onSynthesisDebug),
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
      sourceWindow: { fromDate: dates[0] ?? opts.now, toDate: dates[dates.length - 1] ?? opts.now, conversationCount: convos.length },
    },
  );
}
