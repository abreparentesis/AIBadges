import type {
  CodedInterview,
  CodeType,
  CodeValue,
  CommitRung,
  ParticLevel,
  PrivColor,
  Profile,
  Severity,
} from "./types";

export interface CodeDef {
  type: CodeType;
  values: string[];
  description: string;
  /** Per-profile severity anchors where they differ (PAIN: H2 finance variant). */
  anchors?: Partial<Record<Profile, string>>;
}

const SEV = ["0", "1", "2", "3"];
const PRIV = ["GREEN", "AMBER", "RED"];

export const CODEBOOK: CodeDef[] = [
  {
    type: "PAIN",
    values: SEV,
    description:
      "Pain severity on the segment's owning hypothesis (A→H1 skills visibility, B→H2 overspend, C→H3 quality-of-use signal).",
    anchors: {
      A: "3 = a named decision was blocked or a budget exists; 2 = active workaround in place (spreadsheet, survey, internal tool); 1 = agrees it's a problem when asked; 0 = no pain.",
      B: "3 = AI spend at least 5 to 10x a plausible annual price for this product, with no utilization visibility and an attempted control effort; 2 = spend tracked but renewal decisions made blind; 1 = agrees opacity exists; 0 = spend below that 5-10x floor, too small to fund a purchase.",
      C: "3 = a named decision was blocked or a budget exists (e.g. an internal usage tracker was built); 2 = active workaround in place; 1 = agrees it's a problem when asked; 0 = no pain.",
    },
  },
  {
    type: "SPEND",
    values: ["true"],
    description:
      "Money already going to adjacent solutions (training platforms, SaaS-management tools, internal builds, consultant assessments). Quote should carry the amount when stated.",
  },
  {
    type: "ALT",
    values: ["current"],
    description:
      "What they use today to answer these questions, and its named gaps.",
  },
  {
    type: "BUYER",
    values: ["role"],
    description:
      "Who they say owns budget and decision. Value is the normalized role (e.g. 'cto', 'head of l&d'); use 'TRIANGLE' when a competing owner is named ('HR wants it but IT pays').",
  },
  {
    type: "PRIV_PRE",
    values: PRIV,
    description:
      "H4 reaction BEFORE the privacy-architecture reveal. RED = categorical block (works council, legal, culture); AMBER = conditional (opt-in, aggregates only, EU-hosting, no per-person view); GREEN = no meaningful objection.",
  },
  {
    type: "PRIV_POST",
    values: PRIV,
    description:
      "H4 reaction AFTER the reveal (analysis runs on the employee's side; only derived profiles leave). Decision rules run on this one.",
  },
  {
    type: "PARTIC",
    values: ["low", "mixed", "high"],
    description:
      "Participation-probe verdict: their opt-in estimate combined with whether that coverage still feeds the decision they named. low = coverage below what they themselves called useful.",
  },
  {
    type: "COMMIT",
    values: SEV,
    description:
      "0 = nothing; 1 = referral given (near-zero for platform recruits); 2 = agreed to a prototype session or to discuss a pilot; 3 = agreed to run or scope a paid pilot with a named team.",
  },
];

const byType = new Map(CODEBOOK.map((d) => [d.type, d]));

export function isValidValue(type: CodeType, value: string): boolean {
  const def = byType.get(type);
  if (!def) return false;
  // BUYER and ALT are free-text (any non-empty value); BUYER additionally allows TRIANGLE.
  if (type === "BUYER" || type === "ALT") return value.trim().length > 0;
  if (type === "SPEND") return value === "true";
  return def.values.includes(value);
}

/**
 * Reduce a list of confirmed codes to the struct the rules consume.
 * Last value wins per single-valued type (review order is chronological,
 * so the most recent human decision is authoritative).
 */
export function toCodedInterview(
  interviewId: number,
  codes: CodeValue[],
): CodedInterview {
  const out: CodedInterview = {
    interviewId,
    spend: false,
    buyerCompeting: false,
    commit: 0,
  };
  for (const c of codes) {
    switch (c.type) {
      case "PAIN":
        out.pain = Number(c.value) as Severity;
        break;
      case "SPEND":
        out.spend = true;
        break;
      case "BUYER":
        if (c.value === "TRIANGLE") out.buyerCompeting = true;
        else out.buyerRole = c.value.trim().toLowerCase();
        break;
      case "PRIV_POST":
        out.privPost = c.value as PrivColor;
        break;
      case "PARTIC":
        out.partic = c.value as ParticLevel;
        break;
      case "COMMIT": {
        const rung = Number(c.value) as CommitRung;
        if (rung > out.commit) out.commit = rung; // highest rung reached wins
        break;
      }
      // PRIV_PRE and ALT are diagnostic-only: reported, never rule inputs.
    }
  }
  return out;
}
