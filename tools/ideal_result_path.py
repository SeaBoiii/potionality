#!/usr/bin/env python3
"""Find a concrete answer path that yields a target quiz result.

Examples:
  python tools/ideal_result_path.py --list-results
  python tools/ideal_result_path.py --result-id potion_velvet
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find answer choices for a target result.")
    parser.add_argument("--questions", default="data/questions.json", help="Path to questions JSON")
    parser.add_argument("--results", default="data/results.json", help="Path to results JSON")
    parser.add_argument("--settings", default="data/settings.json", help="Path to settings JSON")
    parser.add_argument("--result-id", help="Target result id (e.g., potion_velvet)")
    parser.add_argument("--list-results", action="store_true", help="List available result IDs and exit")
    return parser.parse_args()


def build_condition_expr(cond: dict[str, Any] | None, final_scores: dict[str, Any], dims: list[str], idx: dict[str, int]):
    from z3 import And, If, Or

    if not cond:
        return True

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


def main() -> int:
    args = parse_args()

    questions = load_json(Path(args.questions)).get("questions", [])
    results = load_json(Path(args.results)).get("results", [])
    dims = [d["id"] for d in load_json(Path(args.settings)).get("dimensions", [])]

    if not questions or not results or not dims:
        print("Invalid input JSON data.", file=sys.stderr)
        return 2

    if args.list_results:
        for r in results:
            print(f"{r['id']}: {r.get('title', '')}")
        return 0

    if not args.result_id:
        print("Provide --result-id or use --list-results.", file=sys.stderr)
        return 2

    target_index = None
    for i, r in enumerate(results):
        if r["id"] == args.result_id:
            target_index = i
            break
    if target_index is None:
        print(f"Unknown result id: {args.result_id}", file=sys.stderr)
        return 2

    try:
        from z3 import And, If, Int, Not, Solver, sat
    except ImportError:
        print("z3-solver is required. Install with: python -m pip install z3-solver", file=sys.stderr)
        return 2

    idx = {d: i for i, d in enumerate(dims)}
    q_count = len(questions)

    solver = Solver()
    choices = [Int(f"c_{q}") for q in range(q_count)]
    score_vars = [[Int(f"s_{q}_{i}") for i in range(len(dims))] for q in range(q_count + 1)]

    for i in range(len(dims)):
        solver.add(score_vars[0][i] == 0)

    for q_i, question in enumerate(questions):
        option_count = len(question["options"])
        solver.add(choices[q_i] >= 0, choices[q_i] <= option_count - 1)
        for d_i, dim in enumerate(dims):
            deltas = [int(opt.get("weights", {}).get(dim, 0)) for opt in question["options"]]
            delta_expr = deltas[0]
            for opt_i in range(1, len(deltas)):
                delta_expr = If(choices[q_i] == opt_i, deltas[opt_i], delta_expr)
            raw = score_vars[q_i][d_i] + delta_expr
            clamped = If(raw < -20, -20, If(raw > 20, 20, raw))
            solver.add(score_vars[q_i + 1][d_i] == clamped)

    final_scores = {d: score_vars[q_count][i] for i, d in enumerate(dims)}

    match_exprs = []
    for result in results:
        conditions = result.get("conditions", [])
        exprs = [build_condition_expr(c, final_scores, dims, idx) for c in conditions]
        match_exprs.append(And(*exprs) if exprs else True)

    target = results[target_index]
    target_priority = target.get("priority", 0)
    solver.add(match_exprs[target_index])

    for j, other in enumerate(results):
        other_priority = other.get("priority", 0)
        if other_priority > target_priority or (other_priority == target_priority and j < target_index):
            solver.add(Not(match_exprs[j]))

    if solver.check() != sat:
        print(f"No answer path found for {args.result_id}")
        return 1

    model = solver.model()
    picked = [model.eval(c).as_long() for c in choices]
    final_map = {d: model.eval(final_scores[d]).as_long() for d in dims}

    print(f"Target result: {target['id']} ({target.get('title', '')})")
    print("\nPick these choices:")
    for i, choice_index in enumerate(picked):
        option = questions[i]["options"][choice_index]
        text = option.get("text", "")
        print(f"Q{i+1}: option {choice_index + 1} - {text}")

    print("\nFinal scores:")
    for d in dims:
        print(f"{d}: {final_map[d]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
