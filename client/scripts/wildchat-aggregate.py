#!/usr/bin/env python3
"""Aggregate the per-user GPT-5.5 band reports into a distribution table.

Usage: python3 scripts/wildchat-aggregate.py   (from client/, after the batch run)
"""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "eval" / "wildchat"
DIMS = ["DELEGATION", "DESCRIPTION", "DISCERNMENT", "DILIGENCE"]
BANDS = ["EMERGING", "DEVELOPING", "PROFICIENT", "ADVANCED"]

rows: list[dict] = []
for udir in sorted(ROOT.glob("u*"), key=lambda p: int(p.name[1:])):
    rep = udir / "gpt55-report.txt"
    if not rep.exists():
        continue
    text = rep.read_text()
    bands = dict(re.findall(r"^(DELEGATION|DESCRIPTION|DISCERNMENT|DILIGENCE) — (\w+)", text, re.M))
    stage = re.search(r"stage (\d)/8", text)
    if len(bands) != 4 or not stage:
        rows.append({"user": udir.name, "error": "incomplete report"})
        continue
    meta = json.loads((udir / "meta.json").read_text()) if (udir / "meta.json").exists() else {}
    row: dict[str, object] = {
        "user": udir.name,
        "convos": meta.get("conversations"),
        "stage": int(stage.group(1)),
    }
    row.update({k.lower(): v for k, v in bands.items()})
    rows.append(row)

ok = [r for r in rows if "error" not in r]
bad = [r for r in rows if "error" in r]

print(f"{len(ok)} users aggregated" + (f", {len(bad)} incomplete: {[r['user'] for r in bad]}" if bad else ""))
print(f"\n{'user':<5} {'convos':<7} {'stage':<6} " + " ".join(f"{dim.lower():<12}" for dim in DIMS))
for r in ok:
    print(f"{r['user']:<5} {r['convos']!s:<7} {r['stage']:<6} " + " ".join(f"{r[dim.lower()]:<12}" for dim in DIMS))

print("\nBand distribution per dimension (n=%d):" % len(ok))
for dim in DIMS:
    c = Counter(r[dim.lower()] for r in ok)
    print(f"  {dim.lower():<12} " + "  ".join(f"{b.lower()}:{c.get(b, 0)}" for b in BANDS))

stages = Counter(r["stage"] for r in ok)
print("\nYegge stage histogram: " + "  ".join(f"{s}:{stages[s]}" for s in sorted(stages)))
