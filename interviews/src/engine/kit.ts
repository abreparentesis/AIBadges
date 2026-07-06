import type { CodeType, Profile } from "./types";

/**
 * The interview kit from docs/research/b2b-validation-interviews.md §2-4,
 * transcribed as structured data. The doc is the source of truth; content
 * here is verbatim.
 */

export interface Stage {
  id: string;
  title: string;
  minMinutes: number;
  maxMinutes: number;
}

export const STAGES: Stage[] = [
  { id: "context", title: "Context", minMinutes: 5, maxMinutes: 5 },
  { id: "pain", title: "Current state and pain", minMinutes: 15, maxMinutes: 20 },
  { id: "alternatives", title: "Alternatives and spend", minMinutes: 10, maxMinutes: 10 },
  { id: "concept", title: "Concept reaction", minMinutes: 10, maxMinutes: 15 },
  { id: "close", title: "Close", minMinutes: 2, maxMinutes: 2 },
];

export interface Question {
  id: string;
  text: string;
  listenFor?: string;
}

export const OPENER: Question[] = [
  {
    id: "op-rollout",
    text: "Walk me through how AI tools got rolled out here. Who pushed for it, and what was the argument?",
  },
  {
    id: "op-working",
    text: "The last time someone senior asked 'is our AI investment actually working?', what happened? Who answered, and with what?",
    listenFor:
      "The money question for every profile. If nobody has ever asked it, that itself is a finding: the pain may not exist yet.",
  },
  {
    id: "op-well",
    text: "What do you look at today to know whether people are using these tools well, not just logging in?",
  },
];

export const QUESTION_BANK: Record<Profile, Question[]> = {
  A: [
    {
      id: "a-assess",
      text: "How do you currently assess someone's AI skills, in hiring or internally? Tell me about the last time you had to.",
    },
    {
      id: "a-training",
      text: "Walk me through your last AI training initiative. How did you decide who needed it? How did you measure whether it worked?",
    },
    {
      id: "a-promo",
      text: "Has AI proficiency come up in promotion, staffing, or hiring decisions? Tell me about a specific case.",
    },
    {
      id: "a-spend",
      text: "What did you spend on AI upskilling last year (courses, platforms, internal time)? Who approved it, and what did they ask for in return?",
    },
    {
      id: "a-map",
      text: "Have you ever tried to build a skills map or maturity view of the org? What happened to it?",
    },
  ],
  B: [
    {
      id: "b-lines",
      text: "Which AI line items are in your budget right now, roughly what size, and how are they trending?",
    },
    {
      id: "b-renewal",
      text: "Walk me through the last AI tool renewal. What data did you have when deciding seat count or tier? What did you wish you had?",
    },
    {
      id: "b-cut",
      text: "Have you ever cut or downgraded an AI subscription? What triggered it, and how did you know it was safe to cut?",
    },
    {
      id: "b-overlap",
      text: "How do you handle the person with a Copilot seat, a ChatGPT seat, and a Claude seat? Is overlap something you can even see?",
    },
    {
      id: "b-finops",
      text: "Do you treat AI spend differently from other SaaS, or is it the same FinOps motion? What tools cover it today?",
      listenFor:
        "If they name a SaaS-management tool (Zylo, Vertice), probe what it fails to tell them about AI specifically. Spend magnitude relative to what we could charge: adjacent spend under ~5-10x a plausible annual price is likely too small to fund a purchase.",
    },
  ],
  C: [
    {
      id: "c-visibility",
      text: "What visibility do you have into how your engineers use AI tools day to day? Show me if you can.",
    },
    {
      id: "c-dashboards",
      text: "You probably have the Copilot or ChatGPT Enterprise admin dashboard. What do you actually use it for, and where does it stop being useful?",
    },
    {
      id: "c-outliers",
      text: "Tell me about someone on the team who is exceptionally good with AI, and someone who isn't. How do you know? Could you have identified them from data?",
    },
    {
      id: "c-internal",
      text: "Have you built anything internal to track AI usage or quality of use? What happened to it?",
      listenFor:
        "Internal tooling attempts are the strongest possible signal: they already paid engineers to build a worse version.",
    },
    {
      id: "c-enablement",
      text: "When you rolled out the tool, what did enablement look like? How did you decide it worked?",
    },
  ],
};

export interface ConceptStep {
  id: string;
  label: string;
  script: string;
  codes: CodeType[];
}

export const CONCEPT_BLOCK: {
  pitch: string;
  note: string;
  steps: ConceptStep[];
} = {
  // Value only — revealing the privacy architecture up front pre-frames the
  // privacy question and manufactures false acceptance.
  pitch:
    "We turn each employee's own AI chat history into an evidence-backed profile of how they use AI: how capably, in what modes, improving or not. The org sees profiles, aggregate maturity dashboards, learning paths, and a view of which seats are underused or redundant.",
  note: "Pitch the value only. Do not mention where the analysis runs until the reveal step.",
  steps: [
    {
      id: "first-reaction",
      label: "First reaction",
      script:
        "What's your first reaction? (Let them talk. Note whether they go to value or to risk.)",
      codes: [],
    },
    {
      id: "month-one",
      label: "Month-one decision",
      script:
        "What would you do with the maturity dashboard in the first month? Which decision does it feed? (Their answer is the 'decision you named' the participation probe refers back to.)",
      codes: [],
    },
    {
      id: "priv-pre",
      label: "Privacy probe — neutral frame",
      script:
        "This means your company gets a per-employee profile derived from each person's chat history. Who at your company would have to say yes, and what would they say? (Push for the actual gatekeepers: legal, works council, security, the employees themselves.)",
      codes: ["PRIV_PRE"],
    },
    {
      id: "priv-post",
      label: "Privacy probe — reveal",
      script:
        "The analysis runs on the employee's side; raw conversations never leave their session, only derived profiles do. Does that change anything? (The pre-to-post delta is the evidence that the privacy model is a real differentiator.)",
      codes: ["PRIV_POST"],
    },
    {
      id: "partic-1",
      label: "Participation probe — opt-in estimate",
      script:
        "This needs each employee to run the analysis themselves, in their own AI session. What fraction of your team would actually do it?",
      codes: [],
    },
    {
      id: "partic-2",
      label: "Participation probe — feed the number back",
      script:
        "At that coverage, is the dashboard still useful for the decision you named? (An aggregate view is worthless at low opt-in; this assumption dies here or in production.)",
      codes: ["PARTIC"],
    },
    {
      id: "buyer",
      label: "Buyer question (H5)",
      script:
        "If you decided to buy this, whose budget would it come from, and who else would have to sign off? (The cross-segment kill hinges on this; do not let it go unasked.)",
      codes: ["BUYER"],
    },
    {
      id: "commit-ladder",
      label: "Commitment ask, escalating",
      script:
        "Can I come back in 6 weeks and show you a prototype on your own data? → Would you run a paid pilot with one team? → Who else should I talk to? (Record exactly which rung they accept. Time, reputation, or money are real; 'sounds great, keep me posted' is a rejection.)",
      codes: ["COMMIT"],
    },
  ],
};

export const SCREENERS: Record<Profile, string[]> = {
  A: [
    "Title: Head of People, Head of L&D, Talent Development lead (CHRO at smaller companies)",
    "Company: 200 to 5,000 employees, active AI adoption push in the last 18 months",
    "Has run or budgeted an AI training initiative, OR was asked by leadership to report on AI skills",
    "LinkedIn title and company verified",
  ],
  B: [
    "Title: CFO (sub-1,000 employees), VP Finance, FinOps lead, procurement owner for SaaS",
    "Company pays for at least two AI tools with 50+ seats total",
    "Personally saw or approved an AI tool invoice or renewal in the last 12 months",
    "LinkedIn title and company verified",
  ],
  C: [
    "Title: CTO, VP Engineering, Head of AI enablement, platform or DevEx lead",
    "Company: 50+ engineers or knowledge workers with company-provided AI tools",
    "Owns or influences which AI tools are deployed and how adoption is driven",
    "LinkedIn title and company verified",
  ],
};

export const PROFILE_LABELS: Record<Profile, string> = {
  A: "Talent / L&D",
  B: "Finance",
  C: "Technical",
};

export const BANK_NOTE =
  "This is a bank, not a checklist. Follow the live thread deep on 3 or 4 questions per block; you will not get through all of them well, and shouldn't try.";
