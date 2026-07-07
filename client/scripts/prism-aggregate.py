#!/usr/bin/env python3
"""Known-groups comparison for the PRISM validation run.

Compares engine ratings between self-reported high- vs low-familiarity users.
Usage: python3 scripts/prism-aggregate.py   (from client/, after the batch)
"""
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "eval" / "prism"
DIMS = ["DELEGATION", "DESCRIPTION", "DISCERNMENT", "DILIGENCE"]
BAND_VALUE = {"EMERGING": 1, "DEVELOPING": 2, "PROFICIENT": 3, "ADVANCED": 4}

groups = json.loads((ROOT / "groups.json").read_text())
rows: list[dict[str, object]] = []
for user_id, meta in sorted(groups.items()):
    rep = ROOT / user_id / "gpt55-report.txt"
    if not rep.exists():
        continue
    text = rep.read_text()
    bands = dict(re.findall(r"^(DELEGATION|DESCRIPTION|DISCERNMENT|DILIGENCE) — (\w+)", text, re.M))
    stage = re.search(r"stage (\d)/8", text)
    if len(bands) != 4 or not stage:
        print(f"  (incomplete: {user_id})")
        continue
    score = sum(BAND_VALUE[b] for b in bands.values())  # 4..16 composite
    row: dict[str, object] = {
        "user": user_id,
        "group": meta["group"],
        "familiarity": meta["familiarity"],
        "stage": int(stage.group(1)),
        "composite": score,
    }
    row.update({k.lower(): v for k, v in bands.items()})
    rows.append(row)

hi = [r for r in rows if r["group"] == "high"]
lo = [r for r in rows if r["group"] == "low"]
print(f"scored: {len(hi)} high-familiarity, {len(lo)} low-familiarity\n")

fmt = "{:<10} {:<5} {:<6} {:<9} " + " ".join(["{:<12}"] * 4)
print(fmt.format("user", "grp", "stage", "composite", *[d.lower() for d in DIMS]))
for r in rows:
    print(fmt.format(str(r["user"]), str(r["group"]), r["stage"], r["composite"],
                     *[str(r[d.lower()]) for d in DIMS]))

def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0

print("\nGroup means (composite 4-16 / stage):")
mh, ml = mean([float(r["composite"]) for r in hi]), mean([float(r["composite"]) for r in lo])  # type: ignore[arg-type]
sh, sl = mean([float(r["stage"]) for r in hi]), mean([float(r["stage"]) for r in lo])  # type: ignore[arg-type]
print(f"  high: composite {mh:.2f}, stage {sh:.2f}")
print(f"  low:  composite {ml:.2f}, stage {sl:.2f}")
print(f"  gap:  composite {mh - ml:+.2f}, stage {sh - sl:+.2f}")

# permutation test on the composite gap (two-sided, 20k shuffles)
if hi and lo:
    observed = mh - ml
    pool = [float(r["composite"]) for r in rows]  # type: ignore[arg-type]
    n_hi = len(hi)
    rng = random.Random(42)
    hits = 0
    trials = 20000
    for _ in range(trials):
        rng.shuffle(pool)
        diff = mean(pool[:n_hi]) - mean(pool[n_hi:])
        if abs(diff) >= abs(observed):
            hits += 1
    print(f"\npermutation test (composite): p = {hits / trials:.3f} "
          f"({'separates the groups' if hits / trials < 0.05 else 'no significant separation at n=%d' % len(rows)})")
