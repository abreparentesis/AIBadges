import { toCodedInterview } from "../engine/codebook";
import { PROFILE_LABELS } from "../engine/kit";
import {
  crossSegmentKill,
  evaluateSegment,
  rankSegments,
  type SegmentVerdict,
} from "../engine/rules";
import type { Profile } from "../engine/types";
import type { Store } from "../store/db";

export const PROFILES: Profile[] = ["A", "B", "C"];

export function segmentVerdicts(store: Store): {
  perProfile: Record<Profile, SegmentVerdict & { label: string; counts: Record<string, number> }>;
  crossSegmentKill: boolean;
  ranking: Profile[];
} {
  const verdicts = new Map<Profile, SegmentVerdict>();
  const avgPain = new Map<Profile, number>();
  const out: any = {};
  for (const profile of PROFILES) {
    const interviews = store.interviewsByProfile(profile);
    const reviewed = interviews.filter((i) => i.status === "reviewed");
    const coded = reviewed.map((i) => toCodedInterview(i.id, store.effectiveCodes(i.id)));
    const verdict = evaluateSegment(coded);
    verdicts.set(profile, verdict);
    const pains = coded.map((c) => c.pain ?? 0);
    avgPain.set(profile, pains.length ? pains.reduce((a, b) => a + b, 0) / pains.length : 0);
    const counts: Record<string, number> = {};
    for (const i of interviews) counts[i.status] = (counts[i.status] ?? 0) + 1;
    out[profile] = { ...verdict, label: PROFILE_LABELS[profile], counts };
  }
  return {
    perProfile: out,
    crossSegmentKill: crossSegmentKill([...verdicts.values()]),
    ranking: rankSegments(verdicts, avgPain),
  };
}
