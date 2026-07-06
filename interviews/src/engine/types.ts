export type Profile = "A" | "B" | "C";

export type CodeType =
  | "PAIN"
  | "SPEND"
  | "ALT"
  | "BUYER"
  | "PRIV_PRE"
  | "PRIV_POST"
  | "PARTIC"
  | "COMMIT";

export type Severity = 0 | 1 | 2 | 3;
export type PrivColor = "GREEN" | "AMBER" | "RED";
export type ParticLevel = "low" | "mixed" | "high";
export type CommitRung = 0 | 1 | 2 | 3;

export interface CodeValue {
  type: CodeType;
  value: string;
}

/**
 * One interview reduced to the fields the decision rules consume.
 * `pain` is scored on the profile's owning hypothesis (A→H1, B→H2, C→H3);
 * the H2 severity anchors differ but the engine only sees the 0-3 value.
 */
export interface CodedInterview {
  interviewId: number;
  pain?: Severity;
  spend: boolean;
  buyerRole?: string;
  buyerCompeting: boolean;
  privPost?: PrivColor;
  partic?: ParticLevel;
  commit: CommitRung;
}
