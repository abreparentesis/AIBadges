import { Profile, Signal } from './types';
import { lookupType } from './typeTable';

export const PROVENANCE_LABEL =
  'Self-computed in your own AI session. Not verified by us.';

export function distill(profile: Profile, now: string): Signal[] {
  const base = { fromProfileVersion: profile.version, disclosure: 'private' as const,
    provenanceLabel: PROVENANCE_LABEL, createdAt: now };

  const identityCard: Signal = {
    ...base, id: `sig-identity-${profile.version}`, type: 'identityCard',
    surfacedContent: { headline: profile.thinking[0]?.claim ?? 'No signal yet',
      thinking: profile.thinking.map((t) => ({ claim: t.claim, confidence: t.confidence })) },
  };
  const trajectorySnippet: Signal = {
    ...base, id: `sig-traj-${profile.version}`, type: 'trajectorySnippet',
    surfacedContent: { shifts: profile.trajectory.shifts.map((s) =>
      ({ dimension: s.dimension, direction: s.direction, velocity: s.velocity })) },
  };
  const signals: Signal[] = [identityCard, trajectorySnippet];

  if (profile.type) {
    const meta = lookupType(profile.type.code);
    const ax = profile.type.axes;
    signals.push({
      ...base, id: `sig-type-${profile.version}`, type: 'typeCard',
      surfacedContent: {
        code: profile.type.code, name: meta.name, group: meta.group, color: meta.color,
        summary: profile.type.summary, confidence: profile.type.confidence,
        axes: {
          EI: { letter: ax.EI.letter, lean: ax.EI.lean }, SN: { letter: ax.SN.letter, lean: ax.SN.lean },
          TF: { letter: ax.TF.letter, lean: ax.TF.lean }, JP: { letter: ax.JP.letter, lean: ax.JP.lean },
        },
      },
    });
  }
  if (profile.capability) {
    const f = profile.capability.aiFluency;
    signals.push({
      ...base, id: `sig-stat-${profile.version}`, type: 'statBadge',
      surfacedContent: {
        yeggeStage: profile.capability.yeggeStage.stage,
        aiFluency: {
          delegation: f.delegation.band, description: f.description.band,
          discernment: f.discernment.band, diligence: f.diligence.band,
        },
      },
    });
  }

  return signals;
}
