# Rating-calibration datasets: decision record

Date: 2026-07-07. Question: which public dataset of real user-LLM conversations should
calibrate and validate the fluency-rating engine?

The engine profiles a person across their whole chat history, so the decisive requirement
is conversations groupable per user, not raw conversation count. Second-order: real organic
usage (shared-link scrapes over-select impressive conversations and would calibrate the
scale high), a license we can build on, timestamps for trajectory, GPT-4-era or later.

## Decision

| Role | Dataset | Why |
|---|---|---|
| Calibration corpus | WildChat-1M (https://huggingface.co/datasets/allenai/WildChat-1M) | 1M conversations, ~100k users groupable by `hashed_ip` (verified in the public schema), ODC-BY license, organic opt-in usage with timestamps and model ids. WildChat-4.8M is the same family, newer era, same license. |
| Ground-truth anchor | PRISM (https://huggingface.co/datasets/HannahRoseKirk/prism-alignment) | Explicit `user_id` plus a per-user survey (demographics, self-reported LLM familiarity): the only correlate of "actual fluency" available. CC-BY-NC on model outputs, so evaluation only, never in anything that ships. |
| Backup validation | LMSYS-Chat-1M (https://huggingface.co/datasets/lmsys/lmsys-chat-1m) | 210k users via IP, commercial use allowed, redistribution forbidden (in-house only). |

## Rejected

- tucnguyen/ShareChat (https://huggingface.co/datasets/tucnguyen/ShareChat): user ids
  deliberately stripped (no per-user grouping possible) and CC-BY-NC.
- P1ayer-1/chatgpt-conversations-chatlogs.net and ar852/scraped-chatgpt-conversations: no
  license at all (hard legal blocker), 2023-era, and ar852 is OCR'd from screenshots with
  10-20% parse errors. Both over-select "look at this" conversations.
- OpenAssistant oasst1/2: clean `user_id` but crowdworkers doing structured tasks, not
  organic usage.
- ShareGPT52K: CC0 but no user linkage and pre-2023.

## What "calibration" means here

The engine is prompt-based (no weights to fine-tune). The datasets feed the staged local
eval harness (`client/scripts/local-eval.ts`, see the eval-harness session notes): group
WildChat by `hashed_ip` into synthetic personal histories, run the real pipeline
(evidence → capability → audit → assemble), and check that ratings (a) spread across
bands rather than clustering, (b) are stable across re-runs and split-half histories, and
(c) rank obviously sophisticated users above obviously basic ones. PRISM's self-reported
familiarity then anchors the scale externally.

Caveat: WildChat users (logged-out ChatGPT, 2023-24) skew casual relative to our real
users; treat absolute band thresholds with suspicion and trust relative discrimination.
`client/scripts/wildchat-prep.ts` implements the per-user sampling.

## Results: 20-user GPT-5.5 distribution (2026-07-07)

Twenty synthetic users (15-39 conversations each) through the full pipeline via
`eval-api.ts` (openai/gpt-5.5, high effort). Aggregate with
`python3 scripts/wildchat-aggregate.py`; per-user reports in `client/eval/wildchat/u*/`.

| Dimension | emerging | developing | proficient | advanced |
|---|---|---|---|---|
| delegation | 0 | 13 | 7 | 0 |
| description | 0 | 10 | 9 | 1 |
| discernment | 10 | 9 | 0 | 1 |
| diligence | 13 | 7 | 0 | 0 |

Yegge stages: 2 ×5 · 3 ×11 · 4 ×3 · 5 ×1. A bell around stage 3 with a thin high tail.

Reading, for badge thresholds on the GPT-5.5 path:
- "Proficient" delegation/description ≈ top third of casual users; "advanced" anywhere is
  a ~5% event (2 band-instances in 80). Diligence above developing did not occur at all in
  this population — any diligence signal is exceptional.
- Discrimination works: one user (u3, stage 5) earned an advanced discernment while five
  users sit at stage 2 with near-uniform emerging/developing rows.
- Cross-model note (u1/u2 vs the audited Claude staged run): identical profile shape and
  stages; GPT-5.5 sat +1 band on soft boundaries, most likely because the staged run used
  an independent fresh audit agent (stronger deflator) vs the in-run self-audit.
- Run-to-run stability: u1 was scored twice (a flaky first run); delegation flipped
  proficient→developing between runs. Soft-boundary bands are ±1 band across reruns;
  threshold logic should not hang product decisions on a single band edge.
- One run in 21 produced an empty capability section (model step failed all retries; the
  engine dropped the section rather than fabricate). Rerunning fixed it.

## Results: PRISM known-groups validation (2026-07-07) — null, with a reason

Design: 10 self-reported high-LLM-familiarity PRISM users vs 9 low, each scored blind
through the full pipeline (`prism-prep.ts` → `eval-api.ts` → `prism-aggregate.py`).
Outcome: **no separation** (composite 5.60 vs 5.44 on a 4-16 scale; permutation p = 0.84).

Why, and what it actually tells us:
- **Floor effect, by design of the input.** PRISM histories are six short, task-prompted
  conversations (~3 turns each); users produced only 4-8 evidence units. 18 of 19 users
  landed at stage 2 with composites in the bottom quarter of the scale. There is almost no
  behavioral surface for delegation, description, or diligence to show in that sample.
- **The engine floored instead of fabricating.** With thin evidence, bands collapsed to
  emerging/developing uniformly rather than spreading randomly or inflating — the
  substance gate and evidence caps behaving exactly as designed. A noisy or sycophantic
  rater would have produced spurious separation; ours refused. That is a pass of the
  honesty property, and a fail of PRISM as an anchor.
- Conclusion: **PRISM cannot anchor this engine** — its histories are an order of
  magnitude thinner than the ≥15 substantive conversations the engine needs (WildChat
  users, 15-39 conversations, spread across four bands and stages 2-5 on the same
  pipeline the same day). Self-reported familiarity also remains a weak proxy.
- Product implication worth keeping: below roughly 10 substantive conversations the
  ratings are floor-dominated; the extension should present low-history profiles as
  provisional (it already grades confidence by evidence, which this validates).
- Better future anchors: behavioral splits within WildChat (e.g. technical-workflow users
  vs casual), or opt-in self-assessment from real product users once live.

## Better ground-truth candidates (Exa deep-research sweep, 2026-07-07)

Adversarially verified (14/14 claims confirmed, 3-vote panel per claim). Three 2024-2026
academic releases pair per-user chat histories with an EXTERNAL skill measure — the
combination PRISM lacked. No dataset anywhere pairs chats with a validated AI-literacy
scale score; all anchors are task-outcome proxies.

| Dataset | Histories per user | External anchor | Access | Fit |
|---|---|---|---|---|
| ChatBench (https://huggingface.co/datasets/microsoft/ChatBench, ACL 2025) | ~810 Prolific workers × ~9 AI-assisted conversations (7,336 total) | Per-question MMLU correctness (acc 0/1) PLUS a within-user user-alone baseline — enabling "accuracy delta = marginal benefit extracted from AI" per user | CC-BY-4.0, open | **Best**: largest n, objective anchor, and the delta measure is conceptually identical to AI fluency |
| StudyChat (https://huggingface.co/datasets/wmcnicho/StudyChat, LAK 2026) | 203 students × ~11 conversations across a real semester (2,214 total) | Assignment (a1-a7) and exam (e1-e3) scores for consenting students; the paper itself regresses dialogue features on grades | CC-BY-4.0, gated (accept terms) | **Second**: most naturalistic longitudinal histories; course-domain only |
| RealHumanEval (https://huggingface.co/datasets/hsseinmz/realhumaneval, TMLR 2024) | 213-243 coders, chat keyed by programmer_id, but a single ~35-min session (~1,055 chat messages total) | Objective coding-task completion (private unit tests) + time-to-success | CC0, open | Weak-moderate: gold anchor but single-session histories are thinner than PRISM's |

Recommended validation design (ChatBench): score each worker's Phase-2 transcripts blind
with the engine, then correlate against (a) AI-assisted accuracy and (b) the
assisted-minus-alone accuracy delta. The delta is the cleanest available operational
definition of fluency: how much value this person extracts from the same AI on the same
kind of task. Mind the PRISM lesson: ChatBench conversations are short task QA, so expect
compressed bands; the correlation, not absolute levels, is the test. StudyChat is the
follow-up if the ChatBench signal is positive (longitudinal realism, grade anchors).
