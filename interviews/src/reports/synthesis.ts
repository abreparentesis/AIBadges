import { toCodedInterview } from "../engine/codebook";
import { PROFILE_LABELS } from "../engine/kit";
import { evaluateSegment, type SegmentVerdict } from "../engine/rules";
import type { ParticLevel, PrivColor, Profile } from "../engine/types";
import type { LlmClient } from "../llm/client";
import { prosePrompt } from "../llm/prompts";
import type { Store } from "../store/db";
import { segmentVerdicts } from "../api/segments";

export interface QuoteRef {
  quote: string;
  interview: string; // pseudonym, e.g. "P3"
}

export interface SynthesisFacts {
  profile: Profile;
  label: string;
  verdict: SegmentVerdict;
  severityHistogram: number[]; // index = severity 0-3
  buyerRole?: string;
  alternatives: QuoteRef[];
  spendQuotes: QuoteRef[];
  commitDistribution: number[]; // index = rung 0-3
  privPre: Record<PrivColor, number>;
  privPost: Record<PrivColor, number>;
  partic: Record<ParticLevel, number>;
  topQuotes: QuoteRef[];
}

const PRIV_ZERO = { GREEN: 0, AMBER: 0, RED: 0 } as const;

export function buildFacts(profile: Profile, store: Store): SynthesisFacts {
  const reviewed = store.interviewsByProfile(profile).filter((i) => i.status === "reviewed");
  const severityHistogram = [0, 0, 0, 0];
  const commitDistribution = [0, 0, 0, 0];
  const privPre: Record<PrivColor, number> = { ...PRIV_ZERO };
  const privPost: Record<PrivColor, number> = { ...PRIV_ZERO };
  const partic: Record<ParticLevel, number> = { low: 0, mixed: 0, high: 0 };
  const alternatives: QuoteRef[] = [];
  const spendQuotes: QuoteRef[] = [];
  const topQuotes: QuoteRef[] = [];
  const coded = [];

  for (const interview of reviewed) {
    const participant = store.getParticipant(interview.participantId)!;
    const codes = store.effectiveCodes(interview.id);
    const ci = toCodedInterview(interview.id, codes);
    coded.push(ci);
    severityHistogram[ci.pain ?? 0]++;
    commitDistribution[ci.commit]++;
    if (ci.privPost) privPost[ci.privPost]++;
    if (ci.partic) partic[ci.partic]++;
    for (const c of codes) {
      const ref = { quote: c.quote, interview: participant.pseudonym };
      if (c.type === "PRIV_PRE" && (c.value as PrivColor) in privPre) privPre[c.value as PrivColor]++;
      if (c.type === "ALT") alternatives.push(ref);
      if (c.type === "SPEND") spendQuotes.push(ref);
      if (c.type === "PAIN" && Number(c.value) >= 2 && c.quote) topQuotes.push(ref);
    }
  }

  return {
    profile,
    label: PROFILE_LABELS[profile],
    verdict: evaluateSegment(coded),
    severityHistogram,
    buyerRole: evaluateSegment(coded).metrics.buyerRole,
    alternatives,
    spendQuotes,
    commitDistribution,
    privPre,
    privPost,
    partic,
    topQuotes: topQuotes.slice(0, 3),
  };
}

/** Every number in the facts must appear verbatim in the draft. */
export function verifyNumbers(facts: SynthesisFacts, draft: string): string[] {
  const missing: string[] = [];
  const need = new Set<string>();
  need.add(String(facts.verdict.metrics.n));
  for (const pctField of [
    facts.verdict.metrics.painRealPct,
    facts.verdict.metrics.spendPct,
    facts.verdict.metrics.commit2PlusPct,
    facts.verdict.metrics.privRedPct,
  ]) {
    need.add(pctField.toFixed(0));
  }
  for (const num of need) {
    if (!draft.includes(num)) missing.push(num);
  }
  return missing;
}

function factsMarkdown(f: SynthesisFacts): string {
  const m = f.verdict.metrics;
  const lines = [
    `## Segment ${f.profile} — ${f.label}`,
    "",
    `**Verdict: ${f.verdict.verdict}** (${f.verdict.reasons.join("; ") || "no reasons"})`,
    "",
    `- Interviews reviewed: ${m.n}`,
    `- Pain severity histogram (0→3): ${f.severityHistogram.join(" / ")} — ${m.painRealPct.toFixed(0)}% at ≥2`,
    `- Spend evidence: ${m.spendPct.toFixed(0)}%${f.spendQuotes.length ? ` — e.g. "${f.spendQuotes[0].quote}" (${f.spendQuotes[0].interview})` : ""}`,
    `- Buyer: ${f.buyerRole ?? "no consistent buyer"}`,
    `- COMMIT rungs (0→3): ${f.commitDistribution.join(" / ")} — ${m.commit2PlusPct.toFixed(0)}% at 2+, COMMIT-3 ${m.hasCommit3 ? "present" : "absent"}`,
    `- Privacy pre-reveal G/A/R: ${f.privPre.GREEN}/${f.privPre.AMBER}/${f.privPre.RED}; post-reveal: ${f.privPost.GREEN}/${f.privPost.AMBER}/${f.privPost.RED} (RED ${m.privRedPct.toFixed(0)}%)`,
    `- Participation low/mixed/high: ${f.partic.low}/${f.partic.mixed}/${f.partic.high}`,
  ];
  if (f.alternatives.length) {
    lines.push(`- Current alternative: "${f.alternatives[0].quote}" (${f.alternatives[0].interview})`);
  }
  if (f.topQuotes.length) {
    lines.push("", "**Top pain quotes:**");
    for (const q of f.topQuotes) lines.push(`> "${q.quote}" — ${q.interview}`);
  }
  return lines.join("\n");
}

export async function draftSynthesis(facts: SynthesisFacts, client: LlmClient): Promise<string> {
  const factsMd = factsMarkdown(facts);
  let prose = "";
  let warning = "";
  try {
    prose = await client.complete({
      system: "You write terse, factual research-synthesis prose. Never invent numbers.",
      user: prosePrompt(`Segment ${facts.profile} (${facts.label})`, JSON.stringify(facts.verdict.metrics)),
    });
    const missing = verifyNumbers(facts, factsMd + "\n" + prose);
    if (missing.length) warning = `\n> ⚠ Prose may have altered numbers (missing: ${missing.join(", ")}). Trust the facts block.\n`;
  } catch (e) {
    warning = `\n> Prose unavailable (${(e as Error).message}); facts below are engine-computed.\n`;
  }
  return `${factsMd}\n${warning}\n${prose}`.trim();
}

export async function finalReport(store: Store, client: LlmClient): Promise<string> {
  const seg = segmentVerdicts(store);
  const parts: string[] = ["# AIBadges B2B validation — final report", ""];
  if (seg.crossSegmentKill) {
    parts.push(
      "> **Cross-segment kill (H5): no segment surfaced a consistent single buyer with budget authority. Kill or rescope the B2B angle regardless of pain and spend scores.**",
      "",
    );
  }
  if (seg.ranking.length) {
    parts.push(`**Build order (PROCEED segments, ranked):** ${seg.ranking.map((p) => `${p} (${PROFILE_LABELS[p]})`).join(" → ")}`, "");
  } else {
    parts.push("**No segment reached PROCEED.**", "");
  }
  for (const profile of ["A", "B", "C"] as Profile[]) {
    parts.push(await draftSynthesis(buildFacts(profile, store), client), "");
  }
  return parts.join("\n");
}
