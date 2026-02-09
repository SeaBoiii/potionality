#!/usr/bin/env python3
"""Reachability and probability checker for potion quiz results.

Usage examples:
  python tools/reachability_check.py --samples 200000
  python tools/reachability_check.py --samples 500000 --seed 42
  python tools/reachability_check.py --reachability-only
  python tools/reachability_check.py --sampling-only --samples 1000000
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any


def clamp(value: int, min_value: int = -20, max_value: int = 20) -> int:
    return max(min_value, min(max_value, value))


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def sorted_scores(score_map: dict[str, int], dims: list[str]) -> list[tuple[str, int]]:
    # Match JS stable sort behavior for ties by preserving dimension order.
    return sorted(((d, score_map.get(d, 0)) for d in dims), key=lambda item: item[1], reverse=True)


def meets_condition(cond: dict[str, Any] | None, scores: dict[str, int], dims: list[str]) -> bool:
    if not cond:
        return True

    if "dim" in cond and "type" not in cond:
        value = scores.get(cond["dim"], 0)
        if "min" in cond or "max" in cond:
            min_v = cond.get("min", -math.inf)
            max_v = cond.get("max", math.inf)
            return min_v <= value <= max_v

        op = cond.get("op", "gte")
        target = cond.get("value", 0)
        if op == "gt":
            return value > target
        if op == "lt":
            return value < target
        if op == "lte":
            return value <= target
        if op == "eq":
            return value == target
        return value >= target

    cond_type = cond.get("type")
    dim = cond.get("dim", "calm")
    value = cond.get("value", 0)

    if cond_type == "min":
        return scores.get(dim, 0) >= value
    if cond_type == "max_le":
        return scores.get(dim, 0) <= value
    if cond_type == "max_ge":
        return scores.get(dim, 0) >= value
    if cond_type == "diff_greater":
        return scores.get(cond["a"], 0) > scores.get(cond["b"], 0) + value
    if cond_type == "diff_abs_lte":
        return abs(scores.get(cond["a"], 0) - scores.get(cond["b"], 0)) <= value
    if cond_type == "top_is":
        return sorted_scores(scores, dims)[0][0] == cond["dim"]
    if cond_type == "not_top_is":
        return sorted_scores(scores, dims)[0][0] != cond["dim"]
    if cond_type == "rank_is":
        ranked = sorted_scores(scores, dims)
        rank = max(1, int(cond.get("rank", 1)))
        return len(ranked) >= rank and ranked[rank - 1][0] == cond["dim"]
    if cond_type == "top_diff_gte":
        ranked = sorted_scores(scores, dims)
        top = ranked[0][1]
        second = ranked[1][1] if len(ranked) > 1 else 0
        return top - second >= value
    if cond_type == "top_diff_lte":
        ranked = sorted_scores(scores, dims)
        top = ranked[0][1]
        second = ranked[1][1] if len(ranked) > 1 else 0
        return top - second <= value
    if cond_type == "total_min":
        return sum(scores.get(d, 0) for d in dims) >= value
    if cond_type == "total_max":
        return sum(scores.get(d, 0) for d in dims) <= value
    if cond_type == "sum_min":
        dims_list = cond.get("dims", [])
        return sum(scores.get(d, 0) for d in dims_list) >= value
    if cond_type == "sum_max":
        dims_list = cond.get("dims", [])
        return sum(scores.get(d, 0) for d in dims_list) <= value
    if cond_type == "spread_between":
        vals = [scores.get(d, 0) for d in dims]
        spread = (max(vals) - min(vals)) if vals else 0
        min_v = cond.get("min", 0)
        max_v = cond.get("max", math.inf)
        return min_v <= spread <= max_v

    return True


def result_matches(result: dict[str, Any], scores: dict[str, int], dims: list[str]) -> bool:
    conditions = result.get("conditions", [])
    if not conditions:
        return True
    return all(meets_condition(c, scores, dims) for c in conditions)


def resolve_result(results: list[dict[str, Any]], scores: dict[str, int], dims: list[str]) -> dict[str, Any]:
    candidates = [r for r in results if result_matches(r, scores, dims)]
    if not candidates:
        raise RuntimeError("No matching result found; check JSON conditions.")

    best = None
    best_priority = -math.inf
    for result in candidates:
        priority = result.get("priority", 0)
        if isinstance(priority, (int, float)) and priority > best_priority:
            best = result
            best_priority = priority
    if best is None:
        best = candidates[0]

    # Tie-break by original list order at equal priority.
    tied = [r for r in candidates if r.get("priority", 0) == best_priority]
    if len(tied) > 1:
        for original in results:
            if original in tied:
                return original
    return best


def apply_option(scores: dict[str, int], option: dict[str, Any], dims: list[str]) -> None:
    for dim in dims:
        delta = int(option.get("weights", {}).get(dim, 0))
        scores[dim] = clamp(scores.get(dim, 0) + delta, -20, 20)


def run_sampling(
    questions: list[dict[str, Any]],
    results: list[dict[str, Any]],
    dims: list[str],
    samples: int,
    seed: int | None,
) -> dict[str, int]:
    rng = random.Random(seed)
    counts: dict[str, int] = {r["id"]: 0 for r in results}

    for _ in range(samples):
        scores = {d: 0 for d in dims}
        for q in questions:
            options = q.get("options", [])
            chosen = options[rng.randrange(len(options))]
            apply_option(scores, chosen, dims)
        result_id = resolve_result(results, scores, dims)["id"]
        counts[result_id] += 1

    return counts


def _sampling_worker(args: tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], int, int]) -> dict[str, int]:
    questions, results, dims, samples, seed = args
    return run_sampling(questions, results, dims, samples, seed)


def _split_even(total_items: int, chunks: int) -> list[tuple[int, int]]:
    if chunks <= 0:
        return []
    base = total_items // chunks
    rem = total_items % chunks
    ranges = []
    start = 0
    for i in range(chunks):
        size = base + (1 if i < rem else 0)
        end = start + size
        if start < end:
            ranges.append((start, end))
        start = end
    return ranges


def _run_sampling_parallel(
    questions: list[dict[str, Any]],
    results: list[dict[str, Any]],
    dims: list[str],
    samples: int,
    seed: int | None,
    workers: int,
) -> dict[str, int]:
    if workers <= 1:
        return run_sampling(questions, results, dims, samples, seed)

    counts: dict[str, int] = {r["id"]: 0 for r in results}
    sample_ranges = _split_even(samples, workers)
    base_seed = 0 if seed is None else seed
    payloads = []
    for i, (start, end) in enumerate(sample_ranges):
        chunk_size = end - start
        payloads.append((questions, results, dims, chunk_size, base_seed + i * 1_000_003))

    with ProcessPoolExecutor(max_workers=workers) as ex:
        partials = ex.map(_sampling_worker, payloads)
        for partial in partials:
            for rid, value in partial.items():
                counts[rid] = counts.get(rid, 0) + value

    return counts


def _reachability_worker(
    payload: tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[int], bool]
) -> tuple[dict[str, bool], dict[str, list[int]]]:
    questions, results, dims, indexes, include_witness = payload
    try:
        from z3 import And, If, Int, Not, Or, Solver, sat
    except ImportError as exc:
        raise RuntimeError(
            "z3-solver is required for exhaustive reachability check. Install with: "
            "python -m pip install z3-solver"
        ) from exc

    idx = {d: i for i, d in enumerate(dims)}
    q_count = len(questions)

    base = Solver()
    choices = [Int(f"c_{q}") for q in range(q_count)]
    score_vars = [[Int(f"s_{q}_{i}") for i in range(len(dims))] for q in range(q_count + 1)]

    for i in range(len(dims)):
        base.add(score_vars[0][i] == 0)

    for q_i, question in enumerate(questions):
        base.add(choices[q_i] >= 0, choices[q_i] <= len(question["options"]) - 1)
        for d_i, dim in enumerate(dims):
            deltas = [int(opt.get("weights", {}).get(dim, 0)) for opt in question["options"]]
            delta_expr = deltas[0]
            for opt_i in range(1, len(deltas)):
                delta_expr = If(choices[q_i] == opt_i, deltas[opt_i], delta_expr)

            raw = score_vars[q_i][d_i] + delta_expr
            clamped = If(raw < -20, -20, If(raw > 20, 20, raw))
            base.add(score_vars[q_i + 1][d_i] == clamped)

    final_scores = {d: score_vars[q_count][i] for i, d in enumerate(dims)}

    def is_top_dim_expr(dim_name: str):
        i = idx[dim_name]
        v = final_scores[dim_name]
        checks = []
        for j, other in enumerate(dims):
            if j == i:
                continue
            ov = final_scores[other]
            checks.append(v > ov if j < i else v >= ov)
        return And(*checks)

    def second_value_for_top(top_name: str):
        others = [d for d in dims if d != top_name]
        expr = final_scores[others[0]]
        for dim_name in others[1:]:
            expr = If(final_scores[dim_name] > expr, final_scores[dim_name], expr)
        return expr

    def top_diff_compare(op: str, value: int):
        clauses = []
        for dim_name in dims:
            top_v = final_scores[dim_name]
            second_v = second_value_for_top(dim_name)
            cmp_expr = (top_v - second_v >= value) if op == "gte" else (top_v - second_v <= value)
            clauses.append(And(is_top_dim_expr(dim_name), cmp_expr))
        return Or(*clauses)

    def cond_expr(cond: dict[str, Any] | None):
        if not cond:
            return True

        if "dim" in cond and "type" not in cond:
            score_var = final_scores[cond["dim"]]
            if "min" in cond or "max" in cond:
                pieces = []
                if "min" in cond:
                    pieces.append(score_var >= int(cond["min"]))
                if "max" in cond:
                    pieces.append(score_var <= int(cond["max"]))
                return And(*pieces) if pieces else True

            op = cond.get("op", "gte")
            target = int(cond.get("value", 0))
            if op == "gt":
                return score_var > target
            if op == "lt":
                return score_var < target
            if op == "lte":
                return score_var <= target
            if op == "eq":
                return score_var == target
            return score_var >= target

        cond_type = cond.get("type")
        value = int(cond.get("value", 0))

        if cond_type == "min":
            return final_scores[cond.get("dim", "calm")] >= value
        if cond_type == "max_le":
            return final_scores[cond.get("dim", "calm")] <= value
        if cond_type == "max_ge":
            return final_scores[cond.get("dim", "calm")] >= value
        if cond_type == "diff_greater":
            return final_scores[cond["a"]] > final_scores[cond["b"]] + value
        if cond_type == "diff_abs_lte":
            a = final_scores[cond["a"]]
            b = final_scores[cond["b"]]
            return If(a - b >= 0, a - b, b - a) <= value
        if cond_type == "top_is":
            return is_top_dim_expr(cond["dim"])
        if cond_type == "not_top_is":
            return Not(is_top_dim_expr(cond["dim"]))
        if cond_type == "rank_is":
            # Currently supports rank 1 semantics (same as top_is). Other ranks are ignored safely.
            rank = int(cond.get("rank", 1))
            if rank == 1:
                return is_top_dim_expr(cond["dim"])
            return True
        if cond_type == "top_diff_gte":
            return top_diff_compare("gte", value)
        if cond_type == "top_diff_lte":
            return top_diff_compare("lte", value)
        if cond_type == "total_min":
            return sum(final_scores[d] for d in dims) >= value
        if cond_type == "total_max":
            return sum(final_scores[d] for d in dims) <= value
        if cond_type == "sum_min":
            dims_list = cond.get("dims", [])
            return sum(final_scores[d] for d in dims_list) >= value
        if cond_type == "sum_max":
            dims_list = cond.get("dims", [])
            return sum(final_scores[d] for d in dims_list) <= value
        if cond_type == "spread_between":
            spread_min = int(cond.get("min", 0))
            spread_max = int(cond.get("max", 999))
            max_expr = final_scores[dims[0]]
            min_expr = final_scores[dims[0]]
            for dim_name in dims[1:]:
                max_expr = If(final_scores[dim_name] > max_expr, final_scores[dim_name], max_expr)
                min_expr = If(final_scores[dim_name] < min_expr, final_scores[dim_name], min_expr)
            spread = max_expr - min_expr
            return And(spread >= spread_min, spread <= spread_max)

        return True

    match_expressions = []
    for result in results:
        conditions = result.get("conditions", [])
        match_expressions.append(And(*[cond_expr(c) for c in conditions]) if conditions else True)

    reachable: dict[str, bool] = {}
    witnesses: dict[str, list[int]] = {}

    for i in indexes:
        result = results[i]
        s = Solver()
        s.add(base.assertions())
        priority = result.get("priority", 0)
        s.add(match_expressions[i])

        for j, other in enumerate(results):
            other_priority = other.get("priority", 0)
            if other_priority > priority or (other_priority == priority and j < i):
                s.add(Not(match_expressions[j]))

        ok = s.check() == sat
        rid = result["id"]
        reachable[rid] = ok
        if ok and include_witness:
            model = s.model()
            witnesses[rid] = [model.eval(choices[q]).as_long() for q in range(q_count)]

    return reachable, witnesses


def run_reachability_with_z3(
    questions: list[dict[str, Any]],
    results: list[dict[str, Any]],
    dims: list[str],
    workers: int,
    include_witness: bool,
) -> tuple[dict[str, bool], dict[str, list[int]]]:
    if workers <= 1:
        indexes = list(range(len(results)))
        return _reachability_worker((questions, results, dims, indexes, include_witness))

    ranges = _split_even(len(results), workers)
    payloads = []
    for start, end in ranges:
        payloads.append((questions, results, dims, list(range(start, end)), include_witness))

    reachable: dict[str, bool] = {}
    witnesses: dict[str, list[int]] = {}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        partials = ex.map(_reachability_worker, payloads)
        for part_reachable, part_witnesses in partials:
            reachable.update(part_reachable)
            witnesses.update(part_witnesses)

    return reachable, witnesses


def print_probability_table(results: list[dict[str, Any]], counts: dict[str, int], total: int) -> None:
    print("\nEstimated result probabilities")
    print("------------------------------")
    for result in results:
        rid = result["id"]
        count = counts.get(rid, 0)
        pct = (count / total * 100.0) if total else 0.0
        print(f"{rid:24} {pct:7.3f}%  ({count}/{total})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reachability and probability checker for quiz results.")
    parser.add_argument("--questions", default="data/questions.json", help="Path to questions JSON")
    parser.add_argument("--results", default="data/results.json", help="Path to results JSON")
    parser.add_argument("--settings", default="data/settings.json", help="Path to settings JSON")
    parser.add_argument("--samples", type=int, default=200_000, help="Random sample size for probability estimation")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducible sampling")
    parser.add_argument("--sampling-only", action="store_true", help="Skip exhaustive reachability check")
    parser.add_argument("--reachability-only", action="store_true", help="Skip probability sampling")
    parser.add_argument("--show-witness", action="store_true", help="Show one answer-index witness per reachable result")
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, (os.cpu_count() or 1) - 1),
        help="Number of worker processes for sampling/reachability parallelism",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.samples <= 0:
        print("--samples must be > 0", file=sys.stderr)
        return 2
    if args.workers <= 0:
        print("--workers must be > 0", file=sys.stderr)
        return 2
    if args.sampling_only and args.reachability_only:
        print("Cannot use --sampling-only and --reachability-only together.", file=sys.stderr)
        return 2

    questions_path = Path(args.questions)
    results_path = Path(args.results)
    settings_path = Path(args.settings)

    questions = load_json(questions_path).get("questions", [])
    results = load_json(results_path).get("results", [])
    dims = [d["id"] for d in load_json(settings_path).get("dimensions", [])]

    if not questions or not results or not dims:
        print("Invalid JSON inputs: ensure questions/results/settings contain expected keys.", file=sys.stderr)
        return 2

    run_reachability = not args.sampling_only
    run_sampling_flag = not args.reachability_only

    reachable_ids: list[str] = []
    unreachable_ids: list[str] = []

    if run_reachability:
        print("Running exhaustive reachability check (SMT)...")
        start = time.perf_counter()
        try:
            reachable, witnesses = run_reachability_with_z3(
                questions, results, dims, workers=args.workers, include_witness=args.show_witness
            )
        except RuntimeError as err:
            print(str(err), file=sys.stderr)
            return 2
        elapsed = time.perf_counter() - start

        reachable_ids = [r["id"] for r in results if reachable.get(r["id"], False)]
        unreachable_ids = [r["id"] for r in results if not reachable.get(r["id"], False)]

        print(f"Reachable results: {len(reachable_ids)}/{len(results)} ({len(reachable_ids)/len(results)*100:.2f}%)")
        if unreachable_ids:
            print("Unreachable:", ", ".join(unreachable_ids))
        else:
            print("Unreachable: none")

        if args.show_witness:
            print("\nWitness answer indexes (0-based option indexes)")
            print("------------------------------------------------")
            for rid in reachable_ids:
                witness = witnesses.get(rid)
                if witness is not None:
                    print(f"{rid}: {witness}")

        print(f"Reachability check time: {elapsed:.2f}s")

    if run_sampling_flag:
        print(f"\nRunning random sampling: n={args.samples}, seed={args.seed}, workers={args.workers}")
        start = time.perf_counter()
        counts = _run_sampling_parallel(
            questions, results, dims, samples=args.samples, seed=args.seed, workers=args.workers
        )
        elapsed = time.perf_counter() - start
        print_probability_table(results, counts, args.samples)
        if run_reachability:
            sampled_seen = {rid for rid, count in counts.items() if count > 0}
            missing_from_sample = [rid for rid in reachable_ids if rid not in sampled_seen]
            print("\nSampling coverage vs exhaustive reachable set")
            print("--------------------------------------------")
            print(f"Sample saw {len(sampled_seen)}/{len(results)} results.")
            if missing_from_sample:
                print("Reachable but not seen in this sample:", ", ".join(missing_from_sample))
            else:
                print("Sample included every reachable result.")
        print(f"Sampling time: {elapsed:.2f}s")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
