# B2B validation interviews: AI maturity for organizations

Goal: decide whether AIBadges should build a B2B product that measures an organization's AI
maturity (dashboards, learning paths, reports) and flags overspend, and if so, which buyer to
build it for first.

Method follows The Mom Test (Rob Fitzpatrick, https://www.momtestbook.com/): ask about the
past and the specific, never pitch until the final segment, and treat compliments as noise.
Only past behavior, money already spent, and concrete commitments count as evidence.

## 1. What we are actually testing

The B2B idea bundles three value propositions that can pass or fail independently. Each
segment tests its own hypothesis plus two shared ones.

| # | Hypothesis | Owning segment | Falsified if |
|---|-----------|----------------|--------------|
| H1 | Orgs cannot answer "how AI-mature are our people?" and this blocks real decisions (training budget, hiring, promotion, rollout) | Talent | They answer it fine with surveys, manager judgment, or vendor dashboards, and no decision is blocked |
| H2 | AI spend is opaque enough, and large enough, that overspend detection is worth paying for | Finance | Spend is small relative to SaaS budget, or seat utilization from vendor admin panels is already good enough |
| H3 | Engineering/AI-enablement leaders lack signal on HOW people use AI (quality of use, not just volume) and want it per-person | Technical | Volume metrics (Copilot dashboard, ChatGPT Enterprise analytics) satisfy them, or they only care at team level |
| H4 | Companies will accept analysis of employees' AI conversations, given the client-side privacy model (raw chats never leave the employee's session) | All | Legal, works council, or culture blocks any chat-derived profiling regardless of architecture |
| H5 | A specific role has budget and authority to buy this within a quarter or two | All | Everyone is interested, nobody owns it |

H4 is the existential one. AIBadges' privacy invariant was designed for consumers who analyze
their own chats. In B2B the subject (employee) and the buyer (employer) are different people,
which turns the same feature into workplace monitoring. If H4 fails across segments, the B2B
angle as currently imagined is dead no matter how strong the pain is, and the fallback is a
bottom-up model (employees opt in and share badges, org sees only aggregates).

## 2. Profiles and recruiting

Interview 6 to 8 people per profile, 18 to 24 total. Stop a segment early if the first five
interviews are uniformly negative on its owning hypothesis.

### Profile A: Talent / L&D
- Title: Head of People, Head of L&D, Talent Development lead, CHRO at smaller companies.
- Company: 200 to 5,000 employees, active AI adoption push in the last 18 months.
- Screener: has run or budgeted an AI training or upskilling initiative, OR has been asked by
  leadership to report on AI skills. Disqualify if AI adoption is not on their roadmap.

### Profile B: Finance / spend owner
- Title: CFO (sub-1,000 employees), VP Finance, FinOps lead, procurement owner for SaaS.
- Company: pays for at least two AI tools (e.g. Copilot, ChatGPT Enterprise, Claude, Gemini)
  with 50+ seats total.
- Screener: personally saw or approved an AI tool invoice or renewal in the last 12 months.

### Profile C: Technical / enablement
- Title: CTO, VP Engineering, Head of AI enablement, platform or DevEx lead.
- Company: 50+ engineers or knowledge workers with company-provided AI tools.
- Screener: owns or influences which AI tools are deployed and how adoption is driven.

### Where to recruit
- Warm intros first (highest show-up rate and honesty).
- LinkedIn outreach filtered by title + "AI enablement / AI adoption" in recent posts. People
  publicly posting about rolling out AI are pre-qualified for the screener.
- Communities: FinOps Foundation (https://www.finops.org/) for Profile B, CIPD or local L&D
  communities for Profile A, CTO/engineering-leadership Slacks (e.g. Rands Leadership
  Slack, https://randsinrepose.com/welcome-to-rands-leadership-slack/) for Profile C.
- Do not offer to demo the product in the outreach message. Frame it as research on how
  companies measure AI adoption ("20 minutes, I'm researching how companies like yours track
  whether AI investment is working, not selling anything").

## 3. Interview structure (40 to 45 minutes)

Same skeleton for all profiles; only the middle block changes.

1. **Context (5 min).** Their role, how AI tools arrived at the company, who drove it.
2. **Current state and pain (15 to 20 min).** The core. Past-tense, specific questions from
   the question bank below. No mention of AIBadges. If they ask what you're building, defer:
   "happy to show you at the end, I don't want to bias what you tell me."
3. **Alternatives and spend (10 min).** What they use today to answer these questions, what
   it costs, what they tried and abandoned.
4. **Concept reaction (5 to 10 min, only now).** One-paragraph pitch, then the privacy probe
   and the commitment ask.
5. **Close (2 min).** Referral ask: "who else thinks about this at your company or elsewhere?"

## 4. Question bank

### Shared opener (all profiles)
- "Walk me through how AI tools got rolled out here. Who pushed for it, and what was the
  argument?"
- "The last time someone senior asked 'is our AI investment actually working?', what
  happened? Who answered, and with what?"
- "What do you look at today to know whether people are using these tools well, not just
  logging in?"

The second question is the money question for every profile. If nobody has ever asked it,
that itself is a finding: the pain may not exist yet.

### Profile A: Talent / L&D
- "How do you currently assess someone's AI skills, in hiring or internally? Tell me about
  the last time you had to."
- "Walk me through your last AI training initiative. How did you decide who needed it? How
  did you measure whether it worked?"
- "Has AI proficiency come up in promotion, staffing, or hiring decisions? Tell me about a
  specific case."
- "What did you spend on AI upskilling last year (courses, platforms, internal time)? Who
  approved it, and what did they ask for in return?"
- "Have you ever tried to build a skills map or maturity view of the org? What happened to
  it?"
- Listen for: decisions actually blocked by missing skills data, money already spent on
  assessment (a budget line to replace), reporting pressure from leadership.

### Profile B: Finance
- "Which AI line items are in your budget right now, roughly what size, and how are they
  trending?"
- "Walk me through the last AI tool renewal. What data did you have when deciding seat count
  or tier? What did you wish you had?"
- "Have you ever cut or downgraded an AI subscription? What triggered it, and how did you
  know it was safe to cut?"
- "How do you handle the person with a Copilot seat, a ChatGPT seat, and a Claude seat? Is
  overlap something you can even see?"
- "Do you treat AI spend differently from other SaaS, or is it the same FinOps motion? What
  tools cover it today?" (If they name a SaaS-management tool like Zylo, https://zylo.com/,
  or Vertice, https://www.vertice.one/, probe what it fails to tell them about AI
  specifically.)
- Listen for: actual spend magnitude (if total AI spend is under ~$50k/yr the pain is likely
  too small), renewal decisions made blind, an existing tool whose gap we would fill.

### Profile C: Technical
- "What visibility do you have into how your engineers use AI tools day to day? Show me if
  you can."
- "You probably have the Copilot or ChatGPT Enterprise admin dashboard. What do you actually
  use it for, and where does it stop being useful?"
- "Tell me about someone on the team who is exceptionally good with AI, and someone who
  isn't. How do you know? Could you have identified them from data?"
- "Have you built anything internal to track AI usage or quality of use? What happened to
  it?"
- "When you rolled out [tool], what did enablement look like? How did you decide it worked?"
- Listen for: dissatisfaction with volume-only metrics, internal tooling attempts (strongest
  possible signal: they already paid engineers to build a worse version), per-person vs
  team-level appetite.

### Concept reaction block (all profiles, final 10 minutes only)

Pitch in two sentences, then shut up: "We turn each employee's own AI chat history into an
evidence-backed profile of how they use AI: how capably, in what modes, improving or not.
The analysis runs inside the employee's own AI session, so raw conversations never reach us
or you; the org sees profiles, aggregate maturity dashboards, learning paths, and a view of
which seats are underused or redundant."

Then:
- "What's your first reaction?" (Let them talk. Note whether they go to value or to risk.)
- Privacy probe (H4): "For this to run here, employees' chat histories get analyzed on their
  side and only derived profiles leave. Who at your company would have to say yes, and what
  would they say?" Push for names of the actual gatekeepers (legal, works council, security,
  the employees themselves).
- "What would you do with the maturity dashboard in the first month? Which decision does it
  feed?"
- Commitment ask, escalating: "Can I come back in 6 weeks and show you a prototype on your
  own data?" then "Would you run a paid pilot with one team?" then "Who else should I talk
  to?" Record exactly which rung they accept. Time, reputation (intros), or money are real;
  "sounds great, keep me posted" is a rejection.

## 5. Analysis plan

### Coding
Tag each transcript within 24 hours of the interview with:

- `PAIN-<H1|H2|H3>` with severity 0 to 3. 3 = a named decision was blocked or a budget
  exists; 2 = active workaround in place (spreadsheet, survey, internal tool); 1 = agrees
  it's a problem when asked; 0 = no pain.
- `SPEND` — money already going to adjacent solutions (training platforms, SaaS-management
  tools, internal builds, consultant assessments), with amounts.
- `ALT` — what they use today and its named gaps.
- `BUYER` — who they say owns budget and decision. Watch for triangles ("HR would want it
  but IT pays") — those kill deals.
- `PRIV-GREEN / PRIV-AMBER / PRIV-RED` — H4 reaction. RED = categorical block (works
  council, legal, culture). AMBER = conditional (opt-in, anonymized aggregates only,
  EU-hosting, no per-person view). GREEN = no meaningful objection.
- `COMMIT-<0..3>` — 0 nothing, 1 referral given, 2 agreed to prototype session, 3 agreed to
  discuss a paid pilot.

### Signal discipline
Strong evidence: specific past events, money already spent, artifacts they show you,
commitments accepted. Weak/ignore: compliments, hypothetical enthusiasm ("we'd definitely
use that"), generic industry talk. Actively hunt disconfirming evidence in every interview:
"the vendor dashboard is enough", "legal would never allow it", "AI spend is too small to
care", "we'd just survey people".

### Decision rules (after 6 to 8 per segment)
- **Proceed on a segment** if ≥50% score PAIN severity ≥2 on its hypothesis, at least 3 show
  existing SPEND, a consistent BUYER emerges, and ≥3 reach COMMIT-2+.
- **Pivot** if pain is real but PRIV-RED dominates: redesign as employee-opt-in, aggregate-
  only, and re-test with 4 more interviews before building.
- **Kill the segment** if pain is mostly severity ≤1 or commitments are all COMMIT-0/1.
- Rank surviving segments by (pain severity × spend evidence × commitment rate) and build
  for the top one only. Resist the dashboard-for-everyone product; the first version serves
  one buyer's one decision.

### Synthesis artifact
One page per segment: hypothesis verdict, severity histogram, named buyer, top 3 verbatim
pain quotes, privacy verdict, list of committed follow-ups with dates. These pages are the
input to the build/no-build decision, not the raw transcripts.

## 6. Logistics
- Record with consent, or take timestamped notes; transcribe same day.
- Two people per call when possible (one asks, one notes), otherwise record.
- Never demo before segment 4 of the script. If a prospect insists on a demo call, book it
  separately and keep this one as research.
- Track everything in a simple sheet: date, name, profile, screener answers, codes,
  commitment rung, next step.
