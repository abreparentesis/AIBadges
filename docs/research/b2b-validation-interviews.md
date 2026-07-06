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
Recruiting runs on research-recruiting platforms. Two are the primary channels; both are
pay-as-you-go with no annual contract and both support live moderated interviews with
screener questions:

- **Respondent (https://www.respondent.io/)** — primary for Profiles B and C. Its panel
  specializes in hard-to-find senior B2B roles (CFOs, IT decision makers, people leaders),
  which is exactly the recruiting bottleneck here. Roughly $40 platform fee per session
  plus a senior-professional incentive of $100 to $200 for 45 minutes.
- **User Interviews (https://www.userinterviews.com/)** — primary for Profile A and
  overflow for the others. Transparent pay-as-you-go (~$98 per B2B session plus incentive),
  fast panel fill, and scheduling plus screener tooling built in.
- **CleverX (https://cleverx.com/)** — fallback if either segment fills slowly: a verified
  B2B panel with strong executive reach, credit-based with no contract, at a higher
  per-participant cost.
- Avoided on purpose: UserTesting (https://www.usertesting.com/) is enterprise-contract
  only (annual minimums, no published pricing) and Wynter (https://wynter.com/) is
  asynchronous-only, so neither fits a solo founder running live interviews.

Budget roughly $200 to $300 all-in per interview, so $5k to $7k for the full 18 to 24.
Warm intros remain a free supplement and still carry the highest honesty; run any
intro through the same screener.

Platform-specific discipline:
- Put the screener questions (Section 2) into the platform screener verbatim, and add one
  trap question with a factual answer (e.g. name the AI tools your company pays for and the
  approximate seat count) — professional panelists exaggerate seniority, so verify title
  and company against LinkedIn before accepting.
- Do not name the product or offer a demo in the study description. Frame it as research on
  how companies measure AI adoption ("45 minutes on how companies like yours track whether
  AI investment is working, not selling anything").
- Paid panelists inflate two codes: referrals (COMMIT-1) and polite enthusiasm are cheap
  for someone being paid to talk. COMMIT-2/3 asks still work — a prototype session on their
  own data and a paid pilot cost their org real effort — but weight COMMIT-1 from platform
  recruits as near-zero.

## 3. Interview structure (45 to 50 minutes)

Same skeleton for all profiles; only the middle block changes.

1. **Context (5 min).** Their role, how AI tools arrived at the company, who drove it.
2. **Current state and pain (15 to 20 min).** The core. Past-tense, specific questions from
   the question bank below. No mention of AIBadges. If they ask what you're building, defer:
   "happy to show you at the end, I don't want to bias what you tell me."
3. **Alternatives and spend (10 min).** What they use today to answer these questions, what
   it costs, what they tried and abandoned.
4. **Concept reaction (10 to 15 min, only now).** One-paragraph pitch, then the privacy,
   participation, and buyer probes, and the commitment ask. This block carries the most
   decision-critical codes; do not let it get squeezed by an overrunning step 2.
5. **Close (2 min).** Referral ask: "who else thinks about this at your company or elsewhere?"

## 4. Question bank

This is a bank, not a checklist. Follow the live thread deep on 3 or 4 questions per block;
you will not get through all of them well in the time budgeted, and shouldn't try.

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
- Listen for: actual spend magnitude relative to what we could charge (if their adjacent AI
  spend isn't at least 5 to 10x a plausible annual price for this product, the pain is likely
  too small to fund a purchase), renewal decisions made blind, an existing tool whose gap we
  would fill.

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

### Concept reaction block (all profiles, final 10 to 15 minutes only)

Pitch the value only, without the privacy architecture (mentioning it up front pre-frames
the privacy question and manufactures false acceptance): "We turn each employee's own AI
chat history into an evidence-backed profile of how they use AI: how capably, in what modes,
improving or not. The org sees profiles, aggregate maturity dashboards, learning paths, and
a view of which seats are underused or redundant."

Then:
- "What's your first reaction?" (Let them talk. Note whether they go to value or to risk.)
- "What would you do with the maturity dashboard in the first month? Which decision does it
  feed?" (Ask this before the participation probe; its answer is the "decision you named"
  that the probe refers back to.)
- Privacy probe (H4), in two steps so the architecture doesn't lead the witness:
  1. Neutral frame first: "This means your company gets a per-employee profile derived from
     each person's chat history. Who at your company would have to say yes, and what would
     they say?" Push for the actual gatekeepers (legal, works council, security, the
     employees themselves). Code PRIV-PRE on this reaction.
  2. Then reveal: "The analysis runs on the employee's side; raw conversations never leave
     their session, only derived profiles do. Does that change anything?" Code PRIV-POST on
     where they land now. The pre-to-post delta is the evidence that the privacy model is a
     real differentiator, not just tolerated.
- Participation probe, two turns so the second half doesn't get lost: first, "This needs
  each employee to run the analysis themselves, in their own AI session. What fraction of
  your team would actually do it?" Then feed their own number back: "At that coverage, is
  the dashboard still useful for the decision you named?" (An aggregate view is worthless at
  low opt-in; this assumption dies here or in production. Code PARTIC on the pair.)
- Buyer question (H5): "If you decided to buy this, whose budget would it come from, and who
  else would have to sign off?" Code BUYER on the answer; the cross-segment kill hinges on
  it, so do not let it go unasked.
- Commitment ask, escalating: "Can I come back in 6 weeks and show you a prototype on your
  own data?" then "Would you run a paid pilot with one team?" then "Who else should I talk
  to?" Record exactly which rung they accept. Time, reputation (intros), or money are real;
  "sounds great, keep me posted" is a rejection.

## 5. Analysis plan

### Coding
Tag each transcript within 24 hours of the interview with:

- `PAIN-<H1|H2|H3>` with severity 0 to 3. For H1/H3: 3 = a named decision was blocked or a
  budget exists; 2 = active workaround in place (spreadsheet, survey, internal tool); 1 =
  agrees it's a problem when asked; 0 = no pain. For H2 anchor to magnitude and opacity
  instead (a budget line always exists in finance, so "a budget exists" would auto-score 3):
  3 = AI spend at least 5 to 10x a plausible annual price for this product, with no
  utilization visibility and an attempted control effort; 2 = spend tracked but renewal
  decisions made blind; 1 = agrees opacity exists; 0 = spend below that 5-10x floor, too
  small to fund a purchase. (Binding the floor into the anchor is what lets it kill a
  finance segment via the normal PAIN gates.)
- `SPEND` — money already going to adjacent solutions (training platforms, SaaS-management
  tools, internal builds, consultant assessments), with amounts.
- `ALT` — what they use today and its named gaps.
- `BUYER` — who they say owns budget and decision. Watch for triangles ("HR would want it
  but IT pays") — those kill deals. A segment has a consistent BUYER when ≥50% of its
  interviews name the same role as budget owner and no competing owner is named; the
  Proceed rule and the cross-segment kill both use this bar.
- `PRIV-PRE` and `PRIV-POST`, each GREEN/AMBER/RED — H4 reaction before and after the
  privacy-architecture reveal. RED = categorical block (works council, legal, culture).
  AMBER = conditional (opt-in, anonymized aggregates only, EU-hosting, no per-person view).
  GREEN = no meaningful objection. Decision rules run on PRIV-POST; the pre-to-post delta
  measures whether the architecture is a differentiator.
- `PARTIC-<low|mixed|high>` — participation-probe verdict: their opt-in estimate combined
  with whether that coverage still feeds the decision they named. low = coverage below what
  they themselves called useful.
- `COMMIT-<0..3>` — 0 nothing, 1 referral given, 2 agreed to a prototype session or to
  discuss a pilot, 3 agreed to run or scope a paid pilot with a named team. (Agreeing to a
  conversation costs them nothing; only a yes to running a pilot is a money signal.)

### Signal discipline
Strong evidence: specific past events, money already spent, artifacts they show you,
commitments accepted. Weak/ignore: compliments, hypothetical enthusiasm ("we'd definitely
use that"), generic industry talk. Actively hunt disconfirming evidence in every interview:
"the vendor dashboard is enough", "legal would never allow it", "AI spend is too small to
care", "we'd just survey people".

### Decision rules (after 5 to 8 per segment, including early-stopped ones)
Evaluate in order — Kill, then Pivot, then Proceed, then Hold — so every segment lands in
exactly one bucket. All thresholds are proportions of that segment's completed interviews,
so a segment stopped early at 5 is judged by the same bar as one that ran 8.
- **Kill the segment** if pain is mostly severity ≤1, or COMMIT-2+ is under 40% with no
  COMMIT-3 while PRIV-POST-RED is under 50%. (The proportional bar means a stray
  prototype-session yes can't spare a dead segment, and the privacy guard matters:
  privacy-blocked prospects can't commit, so low commitment under dominant PRIV-RED is a
  symptom of the privacy block and belongs to Pivot, not Kill.)
- **Pivot** if pain is real (≥50% at severity ≥2) but PRIV-POST-RED covers ≥50% of the
  segment's interviews: redesign as employee-opt-in, aggregate-only, and re-test with 4
  more interviews before building. Pivot likewise if pain is real (≥50% at severity ≥2)
  and PARTIC is mostly low, whatever the other bars say: low opt-in won't fix itself, so rescope the collection model
  (org-deployed or automated rather than employee-run), and re-test. A participation
  failure must not sit in Hold.
- **Proceed on a segment** if ≥50% score PAIN severity ≥2 on its hypothesis, ≥40% show
  existing SPEND, a consistent BUYER emerges, ≥40% reach COMMIT-2+ with at least one
  COMMIT-3 (a prototype-session yes is curiosity; only an agreement to run a paid pilot
  tests budget and authority), and PARTIC is not mostly low (a dashboard below the coverage
  they themselves called useful decides nothing).
- **Hold** any segment matching none of the above — typically real pain with thin spend
  evidence. (Real pain with almost no commitment is a Kill, not a Hold: talk without
  commitment means they don't care enough.) Hold is a no-build verdict for now; revisit
  only if something material changes, don't keep interviewing hoping for a different
  answer.
- **Cross-segment kill (H5):** if no segment surfaces a consistent single buyer with budget
  authority — every interview points at a triangle ("HR wants it, IT pays") — kill or
  rescope the B2B angle regardless of pain and spend scores.
- Rank surviving segments by (pain severity × spend evidence × commitment rate) and build
  for the top one only. Resist the dashboard-for-everyone product; the first version serves
  one buyer's one decision.

### Synthesis artifact
One page per segment: hypothesis verdict, severity histogram, named buyer, current
alternative and its gap (from the ALT codes), spend magnitude (from the SPEND codes), the
COMMIT-rung distribution, top 3 verbatim pain quotes, privacy verdict (pre and post reveal)
plus participation verdict, list of committed follow-ups with dates. These pages are the
input to the build/no-build decision, not the raw transcripts.

## 6. Logistics
- Record with consent, or take timestamped notes; transcribe same day.
- Two people per call when possible (one asks, one notes), otherwise record.
- Never demo before segment 4 of the script. If a prospect insists on a demo call, book it
  separately and keep this one as research.
- Track everything in a simple sheet: date, name, profile, screener answers, codes,
  commitment rung, next step.
