"""
August — Command Accuracy & Latency Benchmark Runner.

Executes ~100 sample utterances against the Tier 1 deterministic router
and Tier 2 LLM fallback, measuring:
  - Accuracy (%) per category
  - Latency distribution (avg, p50, p95, p99 in milliseconds)
  - Tier distribution (deterministic vs LLM fallback vs rejected)

Usage:
    python tests/benchmark.py
"""

import json
import os
import sys
import time
from collections import defaultdict
from statistics import mean, median

# Ensure Windows stdout handles UTF-8 cleanly
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure project root is on sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend.commands.router import route
from backend.commands.models import parse_command


def run_benchmark():
    dataset_path = os.path.join(os.path.dirname(__file__), "benchmark_dataset.json")
    if not os.path.exists(dataset_path):
        print(f"Error: dataset not found at {dataset_path}")
        return False

    with open(dataset_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    print("=" * 70)
    print(f"  August Intelligence Benchmark -- {len(cases)} Sample Utterances")
    print("=" * 70)

    category_stats = defaultdict(lambda: {"total": 0, "correct": 0, "latencies": []})
    tier_counts = {"deterministic": 0, "llm_fallback": 0, "none": 0}
    all_deterministic_latencies = []

    for item in cases:
        utterance = item["utterance"]
        expected_action = item["expected_action"]
        expected_tier = item["expected_tier"]
        category = item["category"]

        category_stats[category]["total"] += 1

        t0 = time.perf_counter()
        res = route(utterance)
        latency_ms = (time.perf_counter() - t0) * 1000

        resolved_action = res.command.get("action") if res.command else None
        tier = res.tier

        tier_counts[tier] += 1
        if tier == "deterministic":
            all_deterministic_latencies.append(latency_ms)
            category_stats[category]["latencies"].append(latency_ms)

        # Check correctness
        is_correct = False
        if expected_tier == "deterministic":
            if resolved_action == expected_action and tier == "deterministic":
                try:
                    parse_command(res.command)
                    is_correct = True
                except Exception:
                    is_correct = False
        elif expected_tier in ("llm_fallback", "none"):
            # Escalated / rejected as expected
            is_correct = (res.command is None)

        if is_correct:
            category_stats[category]["correct"] += 1

    # ── Summary Report ────────────────────────────────────────────────────────
    print("\n[+] CATEGORY BREAKDOWN:")
    print(f"{'Category':<20} | {'Count':<6} | {'Accuracy':<10} | {'Avg Latency (ms)':<15}")
    print("-" * 65)

    total_samples = len(cases)
    total_correct = 0

    for cat, stat in sorted(category_stats.items()):
        total = stat["total"]
        corr = stat["correct"]
        total_correct += corr
        acc = (corr / total) * 100
        avg_lat = mean(stat["latencies"]) if stat["latencies"] else 0.0
        print(f"{cat:<20} | {total:<6} | {acc:>6.1f}%   | {avg_lat:>10.2f} ms")

    overall_accuracy = (total_correct / total_samples) * 100
    print("-" * 65)
    print(f"{'OVERALL':<20} | {total_samples:<6} | {overall_accuracy:>6.1f}%   |")

    # ── Latency Metrics ───────────────────────────────────────────────────────
    if all_deterministic_latencies:
        sorted_lat = sorted(all_deterministic_latencies)
        p50 = median(sorted_lat)
        p95 = sorted_lat[int(len(sorted_lat) * 0.95)]
        p99 = sorted_lat[int(len(sorted_lat) * 0.99)]
        avg_l = mean(sorted_lat)

        print("\n[+] TIER 1 DETERMINISTIC LATENCY DISTRIBUTION:")
        print(f"  * Average : {avg_l:.2f} ms")
        print(f"  * Median  : {p50:.2f} ms (p50)")
        print(f"  * p95     : {p95:.2f} ms")
        print(f"  * p99     : {p99:.2f} ms")

    print("\n[+] TIER ROUTING DISTRIBUTION:")
    print(f"  * Deterministic (Tier 1)   : {tier_counts['deterministic']} utterances ({(tier_counts['deterministic']/total_samples)*100:.1f}%)")
    print(f"  * Escalated to LLM (Tier 2): {tier_counts['none']} utterances ({(tier_counts['none']/total_samples)*100:.1f}%)")

    print("\n" + "=" * 70)
    passed = overall_accuracy >= 98.0
    print(f"  BENCHMARK RESULT: {'PASSED [OK]' if passed else 'REVIEW NEEDED [!]'} ({overall_accuracy:.1f}% accuracy)")
    print("=" * 70 + "\n")

    return passed


if __name__ == "__main__":
    success = run_benchmark()
    sys.exit(0 if success else 1)
