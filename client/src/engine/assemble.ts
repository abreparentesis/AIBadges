import { Profile, ProfileSchema, EvidenceUnit, Confidence, Claim, Trajectory, CognitiveType, Capability } from './types';

export interface ProfileParts {
  thinking: Claim[];
  trajectory: Trajectory; // window + shifts
  type?: CognitiveType;
  capability?: Capability;
  evidence: EvidenceUnit[];
}

export interface AssembleOpts {
  version: number;
  now: string;
  modelProvenance: string;
  sourceWindow: { fromDate: string; toDate: string; conversationCount: number };
}

// Hold any source of a profile — the Claude in-session pipeline OR an imported ChatGPT/Custom-GPT
// result — to the same credibility rules: a claim/axis/shift survives only if it cites evidence we
// actually have; confidence is regraded from evidence weight (unit count x distinct conversations);
// an axis with no surviving evidence goes neutral; only the referenced evidence is retained. Pure,
// no model calls — both pipelines feed it so the bar is identical regardless of provider.
export function assembleProfile(parts: ProfileParts, opts: AssembleOpts): Profile {
  const { thinking, trajectory, type: cogType, capability, evidence } = parts;
  const evById = new Map(evidence.map((e) => [e.id, e]));
  // Dedupe as well as prune: a repeated id must not inflate the evidence count.
  const keep = (ids: string[]) => [...new Set(ids.filter((id) => evById.has(id)))];

  // Confidence reflects evidence weight: how many units and across how many distinct conversations.
  const gradeConfidence = (ids: string[]): Confidence => {
    const n = ids.length;
    const convoCount = new Set(
      ids.map((id) => evById.get(id)?.sourceRef.conversationId).filter(Boolean),
    ).size;
    if (n >= 3 && convoCount >= 2) return 'high';
    if (n >= 2) return 'medium';
    return 'low';
  };

  // thinking: drop claims with no surviving evidence; grade the rest from their kept ids.
  const thinkingAnchored = thinking.flatMap((c) => {
    const ids = keep(c.evidenceIds);
    if (ids.length === 0) return [];
    return [{ ...c, evidenceIds: ids, confidence: gradeConfidence(ids) }];
  });

  // trajectory: drop unbacked shifts.
  const trajectoryAnchored = {
    ...trajectory,
    shifts: trajectory.shifts.flatMap((s) => {
      const ids = keep(s.evidenceIds);
      return ids.length === 0 ? [] : [{ ...s, evidenceIds: ids }];
    }),
  };

  // type: an axis with no surviving evidence goes neutral (lean 50). Drop the whole type if no axis is backed.
  let typeAnchored: Profile['type'];
  if (cogType) {
    const anchorAxis = (a: typeof cogType.axes.EI) => {
      const ids = keep(a.evidenceIds);
      return ids.length === 0 ? { ...a, evidenceIds: [], lean: 50 } : { ...a, evidenceIds: ids };
    };
    const axes = {
      EI: anchorAxis(cogType.axes.EI),
      SN: anchorAxis(cogType.axes.SN),
      TF: anchorAxis(cogType.axes.TF),
      JP: anchorAxis(cogType.axes.JP),
    };
    const allTypeIds = [...axes.EI.evidenceIds, ...axes.SN.evidenceIds, ...axes.TF.evidenceIds, ...axes.JP.evidenceIds];
    typeAnchored = allTypeIds.length === 0
      ? undefined
      : { ...cogType, axes, confidence: gradeConfidence(allTypeIds) };
  }

  // capability: prune evidenceIds per dimension AND cap the band by how much evidence survives, so a
  // level can never exceed its backing (same weights as gradeConfidence: 0 surviving quotes -> at most
  // emerging, 1 -> developing, 2 -> proficient, 3+ across 2+ distinct conversations -> advanced). This
  // stops an over-generous model from asserting a high band on thin or off-topic evidence. Drop any
  // domain whose evidenceIds don't survive, like thinking claims.
  let capabilityAnchored: Profile['capability'];
  if (capability) {
    const BAND_ORDER = ['emerging', 'developing', 'proficient', 'advanced'] as const;
    // A fluency band must rest on substantive quotes. Fragments ("De la marca grow", "Validar", "in
    // Spanish") carry no evidentiary weight for a capability, and the model routinely pads a band with
    // them; drop them so they neither show as evidence nor count toward the band.
    const MIN_CAP_QUOTE = 24;
    const substantive = (id: string) => (evById.get(id)?.quote ?? '').trim().length >= MIN_CAP_QUOTE;
    const maxBandIdx = (ids: string[]): number => {
      const convoCount = new Set(ids.map((id) => evById.get(id)?.sourceRef.conversationId).filter(Boolean)).size;
      if (ids.length >= 3 && convoCount >= 2) return 3;
      if (ids.length >= 2) return 2;
      if (ids.length >= 1) return 1;
      return 0;
    };
    const anchorBanded = (b: { band: (typeof capability.aiFluency.delegation)['band']; note?: string; nextStep?: string; evidenceIds: string[] }) => {
      const ids = keep(b.evidenceIds).filter(substantive);
      const idx = Math.max(0, Math.min(BAND_ORDER.indexOf(b.band), maxBandIdx(ids)));
      return { band: BAND_ORDER[idx], ...(b.note ? { note: b.note } : {}), ...(b.nextStep ? { nextStep: b.nextStep } : {}), evidenceIds: ids };
    };
    const aiFluency = {
      delegation: anchorBanded(capability.aiFluency.delegation),
      description: anchorBanded(capability.aiFluency.description),
      discernment: anchorBanded(capability.aiFluency.discernment),
      diligence: anchorBanded(capability.aiFluency.diligence),
    };
    // Derive the overall stage from the four evidence-capped bands so the headline level is a
    // principled rollup of the fluencies, not an independent model number. emerging=1..advanced=4;
    // the average maps into the 1-6 chat range, and its evidence is the union of the dimensions'.
    // This maxes at 6, so Orchestrator (7-8) stays unreachable from chat — it unlocks only when an
    // agentic source (Claude Code / Codex) is ingested.
    const BAND_VALUE: Record<string, number> = { emerging: 1, developing: 2, proficient: 3, advanced: 4 };
    const dims = [aiFluency.delegation, aiFluency.description, aiFluency.discernment, aiFluency.diligence];
    const avgBand = dims.reduce((s, d) => s + (BAND_VALUE[d.band] ?? 1), 0) / dims.length;
    const yeggeStage = {
      stage: Math.max(1, Math.min(6, Math.round((avgBand / 4) * 6))),
      evidenceIds: [...new Set(dims.flatMap((d) => d.evidenceIds))],
    };
    // Headline 1-100 score from the same evidence-capped bands. Chat ceiling is 80: the
    // top 20 points belong to Orchestrator behavior (stages 7-8), observable only when an
    // agentic source (Claude Code / Codex) is ingested. all-emerging → 20, all-advanced → 80.
    const fluencyScore = Math.max(1, Math.min(80, Math.round((avgBand / 4) * 80)));
    const domains = capability.domains.flatMap((d) => {
      const ids = keep(d.evidenceIds);
      return ids.length === 0 ? [] : [{ ...d, evidenceIds: ids }];
    });
    capabilityAnchored = { fluencyScore, aiFluency, yeggeStage, domains };
  }

  // Store only the evidence actually referenced by surviving claims/axes/shifts, in original order.
  const referenced = new Set<string>();
  thinkingAnchored.forEach((c) => c.evidenceIds.forEach((id) => referenced.add(id)));
  trajectoryAnchored.shifts.forEach((s) => s.evidenceIds.forEach((id) => referenced.add(id)));
  if (typeAnchored) {
    const a = typeAnchored.axes;
    [...a.EI.evidenceIds, ...a.SN.evidenceIds, ...a.TF.evidenceIds, ...a.JP.evidenceIds].forEach((id) => referenced.add(id));
  }
  if (capabilityAnchored) {
    const f = capabilityAnchored.aiFluency;
    [...f.delegation.evidenceIds, ...f.description.evidenceIds, ...f.discernment.evidenceIds, ...f.diligence.evidenceIds]
      .forEach((id) => referenced.add(id));
    capabilityAnchored.yeggeStage.evidenceIds.forEach((id) => referenced.add(id));
    capabilityAnchored.domains.forEach((d) => d.evidenceIds.forEach((id) => referenced.add(id)));
  }
  const usedEvidence: EvidenceUnit[] = evidence.filter((e) => referenced.has(e.id));

  // Coverage gate: under ~10 source conversations, or with surviving evidence drawn from
  // fewer than 5 distinct conversations, bands floor low regardless of the person
  // (validated against PRISM; see docs/research/rating-calibration-datasets.md). The UI
  // presents provisional profiles as a partial read, not a verdict.
  const evidenceConversations = new Set(usedEvidence.map((e) => e.sourceRef.conversationId)).size;
  const coverage = {
    provisional: opts.sourceWindow.conversationCount < 10 || evidenceConversations < 5,
    conversationCount: opts.sourceWindow.conversationCount,
    evidenceConversations,
  };

  const profile: Profile = {
    version: opts.version, computedAt: opts.now, modelProvenance: opts.modelProvenance,
    sourceWindow: opts.sourceWindow, coverage,
    thinking: thinkingAnchored, trajectory: trajectoryAnchored, type: typeAnchored,
    ...(capabilityAnchored ? { capability: capabilityAnchored } : {}),
    evidence: usedEvidence,
  };
  return ProfileSchema.parse(profile);
}
