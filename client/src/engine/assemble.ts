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

  // capability: prune evidenceIds per aiFluency dimension but KEEP the band even if ids become
  // empty (a band is a critical assessment we don't want to silently drop). Prune yeggeStage ids.
  // Drop any domain whose evidenceIds don't survive, like thinking claims.
  let capabilityAnchored: Profile['capability'];
  if (capability) {
    const anchorBanded = (b: { band: (typeof capability.aiFluency.delegation)['band']; evidenceIds: string[] }) =>
      ({ ...b, evidenceIds: keep(b.evidenceIds) });
    const aiFluency = {
      delegation: anchorBanded(capability.aiFluency.delegation),
      description: anchorBanded(capability.aiFluency.description),
      discernment: anchorBanded(capability.aiFluency.discernment),
      diligence: anchorBanded(capability.aiFluency.diligence),
    };
    const yeggeStage = { ...capability.yeggeStage, evidenceIds: keep(capability.yeggeStage.evidenceIds) };
    const domains = capability.domains.flatMap((d) => {
      const ids = keep(d.evidenceIds);
      return ids.length === 0 ? [] : [{ ...d, evidenceIds: ids }];
    });
    capabilityAnchored = { aiFluency, yeggeStage, domains };
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

  const profile: Profile = {
    version: opts.version, computedAt: opts.now, modelProvenance: opts.modelProvenance,
    sourceWindow: opts.sourceWindow,
    thinking: thinkingAnchored, trajectory: trajectoryAnchored, type: typeAnchored,
    ...(capabilityAnchored ? { capability: capabilityAnchored } : {}),
    evidence: usedEvidence,
  };
  return ProfileSchema.parse(profile);
}
