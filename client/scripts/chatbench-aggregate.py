#!/usr/bin/env python3
"""Correlate engine ratings with ChatBench delta anchors.

Usage: python3 scripts/chatbench-aggregate.py   (from client/, after the batch)
"""
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "eval" / "chatbench"
BAND_VALUE = {"EMERGING": 1, "DEVELOPING": 2, "PROFICIENT": 3, "ADVANCED": 4}

anchors = json.loads((ROOT / "anchors.json").read_text())
rows: list[dict[str, float | str | int]] = []
for worker, a in sorted(anchors.items()):
    rep = ROOT / worker / "gpt55-report.txt"
    if not rep.exists():
        continue
    text = rep.read_text()
    bands = dict(re.findall(r"^(DELEGATION|DESCRIPTION|DISCERNMENT|DILIGENCE) — (\w+)", text, re.M))
    stage = re.search(r"stage (\d)/8", text)
    if len(bands) != 4 or not stage:
        print(f"  (incomplete: {worker})")
        continue
    rows.append({
        "worker": worker,
        "composite": sum(BAND_VALUE[b] for b in bands.values()),
        "stage": int(stage.group(1)),
        "alone": a["aloneAcc"],
        "assisted": a["assistedAcc"],
        "delta": a["delta"],
    })

print(f"scored {len(rows)} workers\n")
print(f"{'worker':<12} {'composite':<10} {'stage':<6} {'alone':<7} {'assisted':<9} {'delta':<7}")
for r in sorted(rows, key=lambda r: float(r['delta'])):  # type: ignore[arg-type]
    print(f"{r['worker']:<12} {r['composite']:<10} {r['stage']:<6} {r['alone']:<7} {r['assisted']:<9} {r['delta']:+.2f}")

def ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[order[k]] = avg
        i = j + 1
    return out

def pearson(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((y - mb) ** 2 for y in b) ** 0.5
    return cov / (va * vb) if va and vb else 0.0

def spearman_with_p(a: list[float], b: list[float], trials: int = 20000) -> tuple[float, float]:
    rho = pearson(ranks(a), ranks(b))
    rng = random.Random(42)
    perm = b[:]
    hits = 0
    for _ in range(trials):
        rng.shuffle(perm)
        if abs(pearson(ranks(a), ranks(perm))) >= abs(rho):
            hits += 1
    return rho, hits / trials

comp = [float(r["composite"]) for r in rows]
for anchor in ("delta", "assisted", "alone"):
    vals = [float(r[anchor]) for r in rows]
    rho, p = spearman_with_p(comp, vals)
    print(f"\nengine composite vs {anchor:<9}: Spearman rho = {rho:+.2f}, permutation p = {p:.3f}")
