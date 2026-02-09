#!/usr/bin/env python3
"""Constrained retuner for quiz weights + result conditions.

This script tunes toward configurable target percentages (CLI args).

Hard constraints enforced:
- Top potion conditions are frozen (only top priorities may change)
- potion_equilibrium.spread_between is frozen
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CLAMP_MIN = -20
CLAMP_MAX = 20


def clamp(value: int, lo: int = CLAMP_MIN, hi: int = CLAMP_MAX) -> int:
    return max(lo, min(hi, value))


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


@dataclass
class Param:
    kind: str
    label: str
    lo: int
    hi: int
    step: int
    # For question weights
    qi: int = -1
    oi: int = -1
    di: int = -1
    # For result fields
    result_index: int = -1
    cond_index: int = -1
    key: str = ""


@dataclass
class GoalConfig:
    non_top_target: float = 8.0
    non_top_tol: float = 1.0
    top_target: float = 4.25
    top_tol: float = 1.0
    equilibrium_target: float = 2.0
    equilibrium_tol: float = 1.0
    fallback_max: float = 0.05
    non_top_weight: float = 2.0
    top_weight: float = 5.0
    equilibrium_weight: float = 80.0
    fallback_overflow_weight: float = 35.0
    fallback_zero_bonus_penalty: float = 400.0
    zero_hit_penalty: float = 1100.0


def condition_bounds(cond: dict[str, Any], key: str) -> tuple[int, int, int]:
    cond_type = cond.get("type")
    if key in ("min", "max"):
        if cond_type == "spread_between":
            return 0, 40, 1
        return -20, 20, 1
    if key == "value":
        if cond_type in ("min", "max_le", "max_ge"):
            return -20, 20, 1
        if cond_type in ("top_diff_gte", "top_diff_lte", "diff_abs_lte"):
            return 0, 20, 1
        if cond_type == "diff_greater":
            return -20, 20, 1
        if cond_type in ("total_min", "total_max"):
            return 0, 160, 1
        if cond_type in ("sum_min", "sum_max"):
            return -160, 160, 1
    return -20, 160, 1


class Engine:
    def __init__(
        self,
        settings_data: dict[str, Any],
        questions_data: dict[str, Any],
        results_data: dict[str, Any],
        seed: int,
    ) -> None:
        self.settings_data = settings_data
        self.questions_data = questions_data
        self.results_data = results_data

        self.dims = [d["id"] for d in settings_data["dimensions"]]
        self.dim_idx = {d: i for i, d in enumerate(self.dims)}
        self.questions = questions_data["questions"]
        self.results = results_data["results"]

        self.q_count = len(self.questions)
        self.o_counts = [len(q["options"]) for q in self.questions]
        self.d_count = len(self.dims)
        self.r_count = len(self.results)

        self.fallback_index = next((i for i, r in enumerate(self.results) if r["id"] == "potion_fallback"), -1)

        self.weights = self._build_weights_matrix()
        self.params_weights = self._build_weight_params()
        self.params_results = self._build_result_params()
        self.weight_param_lookup: dict[tuple[int, int, int], Param] = {
            (p.qi, p.oi, p.di): p for p in self.params_weights
        }
        self.rng = random.Random(seed)

    def _build_weights_matrix(self) -> list[list[list[int]]]:
        weights: list[list[list[int]]] = []
        for q in self.questions:
            q_rows: list[list[int]] = []
            for opt in q.get("options", []):
                w = opt.get("weights", {})
                q_rows.append([int(w.get(dim, 0)) for dim in self.dims])
            weights.append(q_rows)
        return weights

    def _build_weight_params(self) -> list[Param]:
        params: list[Param] = []
        for qi, q in enumerate(self.questions):
            for oi, opt in enumerate(q.get("options", [])):
                w = opt.get("weights", {})
                for dim in self.dims:
                    cur = int(w.get(dim, 0))
                    if cur < 0:
                        lo, hi = -3, -1
                    elif cur == 0:
                        # Allow light cross-dimension tuning to make equilibrium achievable.
                        lo, hi = -1, 2
                    else:
                        lo, hi = 0, 6
                    params.append(
                        Param(
                            kind="weight",
                            label=f"q{qi+1}.o{oi+1}.{dim}",
                            lo=lo,
                            hi=hi,
                            step=1,
                            qi=qi,
                            oi=oi,
                            di=self.dim_idx[dim],
                        )
                    )
        return params

    def _build_result_params(self) -> list[Param]:
        params: list[Param] = []
        for ri, result in enumerate(self.results):
            rid = result["id"]
            is_top = "_top_" in rid
            is_equilibrium = rid == "potion_equilibrium"
            is_fallback = rid == "potion_fallback"

            # Priority:
            if is_top:
                params.append(
                    Param(
                        kind="result",
                        label=f"{rid}.priority",
                        lo=0,
                        hi=40,
                        step=1,
                        result_index=ri,
                        cond_index=-1,
                        key="priority",
                    )
                )
            elif is_fallback:
                # Keep fallback priority fixed (lowest).
                pass
            else:
                params.append(
                    Param(
                        kind="result",
                        label=f"{rid}.priority",
                        lo=0,
                        hi=40,
                        step=1,
                        result_index=ri,
                        cond_index=-1,
                        key="priority",
                    )
                )

            # Conditions:
            # - top conditions are frozen
            # - equilibrium spread_between is frozen
            if is_top:
                continue

            for ci, cond in enumerate(result.get("conditions", [])):
                if is_equilibrium and cond.get("type") == "spread_between":
                    continue
                for key in ("min", "max", "value"):
                    if key in cond and isinstance(cond[key], (int, float)):
                        lo, hi, step = condition_bounds(cond, key)
                        params.append(
                            Param(
                                kind="result",
                                label=f"{rid}.conditions[{ci}].{key}",
                                lo=int(lo),
                                hi=int(hi),
                                step=int(step),
                                result_index=ri,
                                cond_index=ci,
                                key=key,
                            )
                        )
        return params

    def get_value(self, p: Param) -> int:
        if p.kind == "weight":
            return int(self.weights[p.qi][p.oi][p.di])
        if p.key == "priority":
            return int(self.results[p.result_index].get("priority", 0))
        return int(self.results[p.result_index]["conditions"][p.cond_index].get(p.key, 0))

    def set_value(self, p: Param, value: int) -> None:
        value = int(max(p.lo, min(p.hi, value)))
        if p.kind == "weight":
            self.weights[p.qi][p.oi][p.di] = value
            dim = self.dims[p.di]
            self.questions[p.qi]["options"][p.oi]["weights"][dim] = value
            return

        if p.key == "priority":
            self.results[p.result_index]["priority"] = value
        else:
            self.results[p.result_index]["conditions"][p.cond_index][p.key] = value
        self._sanitize_result(self.results[p.result_index])

    @staticmethod
    def _sanitize_result(result: dict[str, Any]) -> None:
        total_min = None
        total_max = None
        for i, cond in enumerate(result.get("conditions", [])):
            ctype = cond.get("type")
            if ctype == "total_min" and "value" in cond:
                cond["value"] = int(max(0, cond["value"]))
                total_min = i
            elif ctype == "total_max" and "value" in cond:
                cond["value"] = int(max(0, cond["value"]))
                total_max = i
            elif ctype in ("top_diff_gte", "top_diff_lte", "diff_abs_lte") and "value" in cond:
                cond["value"] = int(max(0, cond["value"]))
            if ctype == "spread_between":
                if "min" in cond:
                    cond["min"] = int(max(0, cond["min"]))
                if "max" in cond:
                    cond["max"] = int(max(0, cond["max"]))
                if "min" in cond and "max" in cond and cond["min"] > cond["max"]:
                    mid = (cond["min"] + cond["max"]) // 2
                    cond["min"] = mid
                    cond["max"] = mid

        if total_min is not None and total_max is not None:
            lo = int(result["conditions"][total_min].get("value", 0))
            hi = int(result["conditions"][total_max].get("value", 0))
            if lo > hi:
                mid = (lo + hi) // 2
                result["conditions"][total_min]["value"] = mid
                result["conditions"][total_max]["value"] = mid

    def random_profiles(self, n: int, seed: int) -> list[list[int]]:
        rng = random.Random(seed)
        profiles: list[list[int]] = []
        for _ in range(n):
            profile = [rng.randrange(self.o_counts[q_i]) for q_i in range(self.q_count)]
            profiles.append(profile)
        return profiles

    def _cond_ok(
        self,
        cond: dict[str, Any] | None,
        scores: list[int],
        top_idx: int,
        top_val: int,
        second_val: int,
        total: int,
        spread: int,
        ordered: list[int] | None,
    ) -> bool:
        if not cond:
            return True

        ctype = cond.get("type")

        if "dim" in cond and ctype is None:
            dimv = scores[self.dim_idx[cond["dim"]]]
            if "min" in cond or "max" in cond:
                lo = cond.get("min", -10**9)
                hi = cond.get("max", 10**9)
                return lo <= dimv <= hi
            op = cond.get("op", "gte")
            target = cond.get("value", 0)
            if op == "gt":
                return dimv > target
            if op == "lt":
                return dimv < target
            if op == "lte":
                return dimv <= target
            if op == "eq":
                return dimv == target
            return dimv >= target

        value = int(cond.get("value", 0))
        dim = cond.get("dim", "calm")
        dim_i = self.dim_idx.get(dim, 0)

        if ctype == "min":
            return scores[dim_i] >= value
        if ctype == "max_le":
            return scores[dim_i] <= value
        if ctype == "max_ge":
            return scores[dim_i] >= value
        if ctype == "diff_greater":
            return scores[self.dim_idx[cond["a"]]] > scores[self.dim_idx[cond["b"]]] + value
        if ctype == "diff_abs_lte":
            return abs(scores[self.dim_idx[cond["a"]]] - scores[self.dim_idx[cond["b"]]]) <= value
        if ctype == "top_is":
            return top_idx == self.dim_idx[cond["dim"]]
        if ctype == "not_top_is":
            return top_idx != self.dim_idx[cond["dim"]]
        if ctype == "rank_is":
            rank = max(1, int(cond.get("rank", 1)))
            if ordered is None:
                ordered = sorted(range(self.d_count), key=lambda i: scores[i], reverse=True)
            return len(ordered) >= rank and ordered[rank - 1] == self.dim_idx[cond["dim"]]
        if ctype == "top_diff_gte":
            return (top_val - second_val) >= value
        if ctype == "top_diff_lte":
            return (top_val - second_val) <= value
        if ctype == "total_min":
            return total >= value
        if ctype == "total_max":
            return total <= value
        if ctype == "sum_min":
            dims_list = cond.get("dims", [])
            return sum(scores[self.dim_idx[d]] for d in dims_list) >= value
        if ctype == "sum_max":
            dims_list = cond.get("dims", [])
            return sum(scores[self.dim_idx[d]] for d in dims_list) <= value
        if ctype == "spread_between":
            lo = int(cond.get("min", 0))
            hi = int(cond.get("max", 999))
            return lo <= spread <= hi
        return True

    def evaluate_counts(self, profiles: list[list[int]]) -> list[int]:
        counts = [0] * self.r_count
        for profile in profiles:
            scores = [0] * self.d_count
            for qi, oi in enumerate(profile):
                w = self.weights[qi][oi]
                for di in range(self.d_count):
                    scores[di] = clamp(scores[di] + w[di])

            top_idx = 0
            top_val = scores[0]
            second_val = -10**9
            for i, v in enumerate(scores):
                if v > top_val:
                    second_val = top_val
                    top_val = v
                    top_idx = i
                elif i != top_idx and v > second_val:
                    second_val = v
            if second_val == -10**9:
                second_val = top_val

            total = sum(scores)
            spread = max(scores) - min(scores)
            ordered: list[int] | None = None

            best_index = self.fallback_index
            best_priority = -10**9
            for ri, result in enumerate(self.results):
                ok = True
                for cond in result.get("conditions", []):
                    if not self._cond_ok(cond, scores, top_idx, top_val, second_val, total, spread, ordered):
                        ok = False
                        break
                    if cond.get("type") == "rank_is" and ordered is None:
                        ordered = sorted(range(self.d_count), key=lambda i: scores[i], reverse=True)
                if ok:
                    prio = int(result.get("priority", 0))
                    if prio > best_priority:
                        best_priority = prio
                        best_index = ri
            counts[best_index] += 1

        return counts

    def to_distribution(self, counts: list[int], total: int) -> dict[str, float]:
        return {
            self.results[i]["id"]: (counts[i] / total * 100.0 if total else 0.0)
            for i in range(self.r_count)
        }


def target_for_id(rid: str, goals: GoalConfig) -> tuple[float, float]:
    if rid == "potion_equilibrium":
        return goals.equilibrium_target, goals.equilibrium_tol
    if rid == "potion_fallback":
        return 0.0, 0.0
    if "_top_" in rid:
        return goals.top_target, goals.top_tol
    return goals.non_top_target, goals.non_top_tol


def objective(results: list[dict[str, Any]], counts: list[int], samples: int, goals: GoalConfig) -> float:
    score = 0.0
    for i, result in enumerate(results):
        rid = result["id"]
        pct = counts[i] / samples * 100.0
        if rid == "potion_fallback":
            if counts[i] == 0:
                score += goals.fallback_zero_bonus_penalty
            overflow = max(0.0, pct - goals.fallback_max)
            score += ((overflow / max(0.0001, goals.fallback_max)) ** 2) * goals.fallback_overflow_weight
            continue

        # Reachability guard (sampled); heavily penalize zero-hit.
        if counts[i] == 0:
            score += goals.zero_hit_penalty

        target, tol = target_for_id(rid, goals)
        overflow = max(0.0, abs(pct - target) - tol)
        if rid == "potion_equilibrium":
            weight = goals.equilibrium_weight
        elif "_top_" in rid:
            weight = goals.top_weight
        else:
            weight = goals.non_top_weight
        score += weight * (overflow / max(0.001, tol)) ** 2

    return score


def tune(
    engine: Engine,
    opt_profiles: list[list[int]],
    iterations: int,
    seed: int,
    weight_mutation_prob: float,
    goals: GoalConfig,
) -> tuple[dict[str, Any], dict[str, Any], list[int], float]:
    rng = random.Random(seed + 101)
    all_weight_params = engine.params_weights
    all_result_params = engine.params_results

    counts = engine.evaluate_counts(opt_profiles)
    cur_score = objective(engine.results, counts, len(opt_profiles), goals)
    best_score = cur_score
    best_questions = copy.deepcopy(engine.questions_data)
    best_results = copy.deepcopy(engine.results_data)
    best_counts = counts[:]

    start = time.perf_counter()
    for it in range(iterations):
        temp = max(0.01, 1.0 - (it / max(1, iterations)))
        changes: list[tuple[Param, int]] = []

        do_macro = rng.random() < 0.18
        if do_macro and all_weight_params:
            # Macro move: shift one option+dimension across all questions.
            oi = rng.randrange(max(1, engine.o_counts[0]))
            di = rng.randrange(engine.d_count)
            delta = rng.choice([-1, 1]) * (1 + int(rng.random() * 2))
            for qi in range(engine.q_count):
                key = (qi, oi, di)
                p = engine.weight_param_lookup.get(key)
                if p is None:
                    continue
                old = engine.get_value(p)
                new = int(max(p.lo, min(p.hi, old + delta)))
                if new == old:
                    continue
                engine.set_value(p, new)
                changes.append((p, old))
        else:
            n_changes = 1 if rng.random() < 0.75 else 2
            for _ in range(n_changes):
                use_weight = rng.random() < weight_mutation_prob
                pool = all_weight_params if use_weight else all_result_params
                if not pool:
                    continue
                p = pool[rng.randrange(len(pool))]
                old = engine.get_value(p)
                magnitude = 1 + int(rng.random() * (3 if temp > 0.4 else 2))
                delta = p.step * rng.choice([-1, 1]) * magnitude
                new = int(max(p.lo, min(p.hi, old + delta)))
                if new == old:
                    continue
                engine.set_value(p, new)
                changes.append((p, old))

        if not changes:
            continue

        cand_counts = engine.evaluate_counts(opt_profiles)
        cand_score = objective(engine.results, cand_counts, len(opt_profiles), goals)

        accept = False
        if cand_score <= cur_score:
            accept = True
        else:
            uphill = cand_score - cur_score
            accept = rng.random() < math.exp(-uphill / max(0.0001, temp))

        if accept:
            cur_score = cand_score
            counts = cand_counts
            if cand_score < best_score:
                best_score = cand_score
                best_counts = cand_counts[:]
                best_questions = copy.deepcopy(engine.questions_data)
                best_results = copy.deepcopy(engine.results_data)
        else:
            for p, old in reversed(changes):
                engine.set_value(p, old)

        if (it + 1) % max(1, iterations // 20) == 0 or it == 0:
            elapsed = time.perf_counter() - start
            print(
                f"iter {it+1}/{iterations} | cur={cur_score:.4f} best={best_score:.4f} "
                f"| elapsed={elapsed:.1f}s"
            )

    # restore best in-engine for consistency
    engine.questions_data = copy.deepcopy(best_questions)
    engine.results_data = copy.deepcopy(best_results)
    engine.questions = engine.questions_data["questions"]
    engine.results = engine.results_data["results"]
    engine.weights = engine._build_weights_matrix()
    return best_questions, best_results, best_counts, best_score


def summarize_distribution(results: list[dict[str, Any]], counts: list[int], samples: int) -> str:
    lines = []
    for i, result in enumerate(results):
        rid = result["id"]
        pct = counts[i] / samples * 100.0
        lines.append(f"{rid:24} {pct:7.3f}% ({counts[i]}/{samples})")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Constrained retune for results/weights target percentages.")
    parser.add_argument("--repo-root", default=".", help="Repo root")
    parser.add_argument("--samples", type=int, default=12000, help="Optimization sample size")
    parser.add_argument("--final-samples", type=int, default=220000, help="Final validation sample size")
    parser.add_argument("--iterations", type=int, default=2800, help="Optimization iterations")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument(
        "--weight-mutation-prob",
        type=float,
        default=0.45,
        help="Probability of mutating a weight vs a result threshold/priority",
    )
    parser.add_argument("--non-top-target", type=float, default=8.0, help="Target percent for non-top results")
    parser.add_argument("--non-top-tol", type=float, default=1.0, help="Tolerance percent for non-top results")
    parser.add_argument("--top-target", type=float, default=4.25, help="Target percent for _top_ results")
    parser.add_argument("--top-tol", type=float, default=1.0, help="Tolerance percent for _top_ results")
    parser.add_argument("--equilibrium-target", type=float, default=2.0, help="Target percent for equilibrium")
    parser.add_argument("--equilibrium-tol", type=float, default=1.0, help="Tolerance percent for equilibrium")
    parser.add_argument("--fallback-max", type=float, default=0.05, help="Max percent for fallback")
    parser.add_argument("--non-top-weight", type=float, default=2.0, help="Objective weight for non-top results")
    parser.add_argument("--top-weight", type=float, default=5.0, help="Objective weight for _top_ results")
    parser.add_argument("--equilibrium-weight", type=float, default=80.0, help="Objective weight for equilibrium")
    parser.add_argument(
        "--fallback-overflow-weight",
        type=float,
        default=35.0,
        help="Objective weight for fallback overflow above fallback-max",
    )
    parser.add_argument(
        "--zero-hit-penalty",
        type=float,
        default=1100.0,
        help="Penalty when a non-fallback result gets zero hits in optimization sample",
    )
    parser.add_argument("--save", action="store_true", help="Write tuned files to disk")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()

    settings_path = repo_root / "data" / "settings.json"
    questions_path = repo_root / "data" / "questions.json"
    results_path = repo_root / "data" / "results.json"

    settings_data = load_json(settings_path)
    questions_data = load_json(questions_path)
    results_data = load_json(results_path)
    goals = GoalConfig(
        non_top_target=args.non_top_target,
        non_top_tol=args.non_top_tol,
        top_target=args.top_target,
        top_tol=args.top_tol,
        equilibrium_target=args.equilibrium_target,
        equilibrium_tol=args.equilibrium_tol,
        fallback_max=args.fallback_max,
        non_top_weight=args.non_top_weight,
        top_weight=args.top_weight,
        equilibrium_weight=args.equilibrium_weight,
        fallback_overflow_weight=args.fallback_overflow_weight,
        zero_hit_penalty=args.zero_hit_penalty,
    )

    engine = Engine(settings_data, questions_data, results_data, seed=args.seed)

    print(
        f"Loaded: {len(engine.questions)} questions, {len(engine.results)} results, "
        f"{len(engine.params_weights)} weight params, {len(engine.params_results)} result params"
    )
    print(
        "Targets: "
        f"non-top={goals.non_top_target}%±{goals.non_top_tol}, "
        f"top={goals.top_target}%±{goals.top_tol}, "
        f"equilibrium={goals.equilibrium_target}%±{goals.equilibrium_tol}, "
        f"fallback<={goals.fallback_max}%"
    )

    opt_profiles = engine.random_profiles(args.samples, args.seed)
    init_counts = engine.evaluate_counts(opt_profiles)
    init_score = objective(engine.results, init_counts, len(opt_profiles), goals)
    print(f"Initial objective: {init_score:.6f}")

    best_questions, best_results, best_counts, best_score = tune(
        engine=engine,
        opt_profiles=opt_profiles,
        iterations=args.iterations,
        seed=args.seed,
        weight_mutation_prob=args.weight_mutation_prob,
        goals=goals,
    )

    print(f"\nBest objective (optimization sample): {best_score:.6f}")
    print(summarize_distribution(best_results["results"], best_counts, len(opt_profiles)))

    # Final validation on larger independent sample.
    val_engine = Engine(settings_data, best_questions, best_results, seed=args.seed + 1)
    val_profiles = val_engine.random_profiles(args.final_samples, args.seed + 1)
    val_counts = val_engine.evaluate_counts(val_profiles)
    val_score = objective(val_engine.results, val_counts, len(val_profiles), goals)
    print(f"\nValidation objective ({args.final_samples} samples): {val_score:.6f}")
    print(summarize_distribution(val_engine.results, val_counts, len(val_profiles)))

    if args.save:
        q_backup = questions_path.with_suffix(".json.bak")
        r_backup = results_path.with_suffix(".json.bak")
        save_json(q_backup, load_json(questions_path))
        save_json(r_backup, load_json(results_path))
        save_json(questions_path, best_questions)
        save_json(results_path, best_results)
        print(f"\nSaved tuned files. Backups: {q_backup.name}, {r_backup.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
