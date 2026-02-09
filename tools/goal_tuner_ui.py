#!/usr/bin/env python3
"""Interactive goal-based percentage tuner for quiz results.

Features:
- Per-result target % and tolerance
- Fast estimation using pre-sampled answer profiles
- Stochastic optimizer that adjusts numeric condition thresholds (and optional priority)
- Save tuned values back to data/results.json
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import ttk
from typing import Any, Callable


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
class Profile:
    scores: tuple[int, ...]
    top_idx: int
    top_val: int
    second_val: int
    total: int


@dataclass
class TunableParam:
    label: str
    getter: Callable[[list[float]], float]
    setter: Callable[[list[float], float], None]
    lo: float
    hi: float
    step: float


class ResultEvaluator:
    def __init__(self, settings: dict[str, Any], results_data: dict[str, Any]) -> None:
        self.dim_ids = [d["id"] for d in settings["dimensions"]]
        self.dim_idx = {d: i for i, d in enumerate(self.dim_ids)}
        self.results = results_data["results"]

    def _score(self, profile: Profile, dim: str) -> int:
        return profile.scores[self.dim_idx[dim]]

    def _matches_cond(self, cond: dict[str, Any], profile: Profile) -> bool:
        if not cond:
            return True

        cond_type = cond.get("type")
        # Backward compatibility shape: {dim, min/max} or {dim, op, value}
        if "dim" in cond and cond_type is None:
            value = self._score(profile, cond["dim"])
            if "min" in cond or "max" in cond:
                lo = cond.get("min", -math.inf)
                hi = cond.get("max", math.inf)
                return lo <= value <= hi
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

        dim = cond.get("dim", "calm")
        value = cond.get("value", 0)
        if cond_type == "min":
            return self._score(profile, dim) >= value
        if cond_type == "max_le":
            return self._score(profile, dim) <= value
        if cond_type == "max_ge":
            return self._score(profile, dim) >= value
        if cond_type == "diff_greater":
            return self._score(profile, cond["a"]) > self._score(profile, cond["b"]) + value
        if cond_type == "diff_abs_lte":
            return abs(self._score(profile, cond["a"]) - self._score(profile, cond["b"])) <= value
        if cond_type == "top_is":
            return self.top_dim(profile) == cond["dim"]
        if cond_type == "not_top_is":
            return self.top_dim(profile) != cond["dim"]
        if cond_type == "rank_is":
            rank = max(1, int(cond.get("rank", 1)))
            ordered = sorted(
                ((d, profile.scores[self.dim_idx[d]]) for d in self.dim_ids),
                key=lambda item: item[1],
                reverse=True,
            )
            return len(ordered) >= rank and ordered[rank - 1][0] == cond["dim"]
        if cond_type == "top_diff_gte":
            return (profile.top_val - profile.second_val) >= value
        if cond_type == "top_diff_lte":
            return (profile.top_val - profile.second_val) <= value
        if cond_type == "total_min":
            return profile.total >= value
        if cond_type == "total_max":
            return profile.total <= value
        if cond_type == "sum_min":
            dims_list = cond.get("dims", [])
            return sum(self._score(profile, d) for d in dims_list) >= value
        if cond_type == "sum_max":
            dims_list = cond.get("dims", [])
            return sum(self._score(profile, d) for d in dims_list) <= value
        if cond_type == "spread_between":
            vals = list(profile.scores)
            spread = (max(vals) - min(vals)) if vals else 0
            min_v = int(cond.get("min", 0))
            max_v = int(cond.get("max", 999))
            return min_v <= spread <= max_v
        return True

    def top_dim(self, profile: Profile) -> str:
        return self.dim_ids[profile.top_idx]

    def resolve_result_id(self, profile: Profile) -> str:
        best_index = None
        best_priority = -math.inf
        for i, result in enumerate(self.results):
            conds = result.get("conditions", [])
            if all(self._matches_cond(c, profile) for c in conds):
                priority = result.get("priority", 0)
                # Tie-break by original order: only replace on strict greater.
                if priority > best_priority:
                    best_index = i
                    best_priority = priority
        if best_index is None:
            # Should not happen because fallback has empty conditions.
            return self.results[-1]["id"]
        return self.results[best_index]["id"]

    def distribution(self, profiles: list[Profile]) -> dict[str, float]:
        counts = {r["id"]: 0 for r in self.results}
        total = len(profiles)
        for profile in profiles:
            rid = self.resolve_result_id(profile)
            counts[rid] += 1
        return {rid: (count / total * 100.0 if total else 0.0) for rid, count in counts.items()}


def random_profiles(
    questions: list[dict[str, Any]],
    dims: list[str],
    n: int,
    seed: int,
) -> list[Profile]:
    rng = random.Random(seed)
    profiles: list[Profile] = []
    dim_count = len(dims)
    for _ in range(n):
        scores = [0] * dim_count
        for question in questions:
            options = question.get("options", [])
            picked = options[rng.randrange(len(options))]
            weights = picked.get("weights", {})
            for i, dim in enumerate(dims):
                scores[i] = clamp(scores[i] + int(weights.get(dim, 0)))
        top_idx = 0
        top_val = scores[0]
        second_val = -10**9
        for i, val in enumerate(scores):
            if val > top_val:
                second_val = top_val
                top_val = val
                top_idx = i
            elif i != top_idx and val > second_val:
                second_val = val
        if second_val == -10**9:
            second_val = top_val
        profiles.append(
            Profile(
                scores=tuple(scores),
                top_idx=top_idx,
                top_val=top_val,
                second_val=second_val,
                total=sum(scores),
            )
        )
    return profiles


def condition_bounds(cond: dict[str, Any], key: str) -> tuple[float, float, float]:
    cond_type = cond.get("type")
    if key in ("min", "max"):
        if cond_type == "spread_between":
            return 0.0, 40.0, 1.0
        return -20.0, 20.0, 1.0
    if key == "value":
        if cond_type in ("min", "max_le", "max_ge"):
            return -20.0, 20.0, 1.0
        if cond_type in ("top_diff_gte", "top_diff_lte", "diff_abs_lte"):
            return 0.0, 20.0, 1.0
        if cond_type == "diff_greater":
            return -20.0, 20.0, 1.0
        if cond_type in ("total_min", "total_max"):
            return 0.0, 160.0, 1.0
    return -20.0, 160.0, 1.0


def build_tunable_params(results_data: dict[str, Any], include_priority: bool) -> tuple[list[TunableParam], list[float]]:
    params: list[TunableParam] = []
    vector: list[float] = []
    results = results_data["results"]

    def make_getter(index: int) -> Callable[[list[float]], float]:
        return lambda vec, i=index: vec[i]

    def make_setter(index: int) -> Callable[[list[float], float], None]:
        return lambda vec, val, i=index: vec.__setitem__(i, val)

    for r_i, result in enumerate(results):
        rid = result["id"]
        if include_priority:
            idx = len(vector)
            vector.append(float(result.get("priority", 0)))
            params.append(
                TunableParam(
                    label=f"{rid}.priority",
                    getter=make_getter(idx),
                    setter=make_setter(idx),
                    lo=0.0,
                    hi=30.0,
                    step=1.0,
                )
            )
        for c_i, cond in enumerate(result.get("conditions", [])):
            for key in ("min", "max", "value"):
                if key in cond and isinstance(cond[key], (int, float)):
                    lo, hi, step = condition_bounds(cond, key)
                    idx = len(vector)
                    vector.append(float(cond[key]))
                    params.append(
                        TunableParam(
                            label=f"{rid}.conditions[{c_i}].{key}",
                            getter=make_getter(idx),
                            setter=make_setter(idx),
                            lo=lo,
                            hi=hi,
                            step=step,
                        )
                    )
    return params, vector


def apply_vector_to_results(
    base_results_data: dict[str, Any],
    params: list[TunableParam],
    vector: list[float],
    include_priority: bool,
) -> dict[str, Any]:
    tuned = copy.deepcopy(base_results_data)
    # Re-parse labels to assign values.
    for p in params:
        val = p.getter(vector)
        # Integerize all condition/priority thresholds.
        val_i = int(round(val))
        if ".priority" in p.label:
            rid = p.label.split(".priority")[0]
            for result in tuned["results"]:
                if result["id"] == rid:
                    result["priority"] = val_i
                    break
            continue
        rid, rest = p.label.split(".conditions[", 1)
        c_index = int(rest.split("].", 1)[0])
        key = rest.split("].", 1)[1]
        for result in tuned["results"]:
            if result["id"] == rid:
                result["conditions"][c_index][key] = val_i
                break
    if not include_priority:
        # Ensure priorities remain original when disabled.
        original = {r["id"]: r.get("priority", 0) for r in base_results_data["results"]}
        for result in tuned["results"]:
            result["priority"] = original[result["id"]]
    # Sanity constraints for condition pairs on each result.
    for result in tuned["results"]:
        total_min_idx = None
        total_max_idx = None
        for i, cond in enumerate(result.get("conditions", [])):
            ctype = cond.get("type")
            if ctype == "total_min":
                total_min_idx = i
            elif ctype == "total_max":
                total_max_idx = i
            elif ctype in ("top_diff_gte", "top_diff_lte", "diff_abs_lte") and "value" in cond:
                cond["value"] = max(0, int(cond["value"]))
        if total_min_idx is not None and total_max_idx is not None:
            lo = int(result["conditions"][total_min_idx].get("value", 0))
            hi = int(result["conditions"][total_max_idx].get("value", 0))
            if lo > hi:
                midpoint = (lo + hi) // 2
                result["conditions"][total_min_idx]["value"] = midpoint
                result["conditions"][total_max_idx]["value"] = midpoint
    return tuned


def objective_score(
    dist: dict[str, float],
    targets: dict[str, float],
    tolerances: dict[str, float],
) -> float:
    score = 0.0
    for rid, target in targets.items():
        tol = max(0.001, tolerances.get(rid, 0.25))
        diff = abs(dist.get(rid, 0.0) - target)
        # No penalty inside tolerance; quadratic outside.
        overflow = max(0.0, diff - tol)
        score += (overflow / tol) ** 2
    return score


def optimize(
    settings_data: dict[str, Any],
    questions_data: dict[str, Any],
    results_data: dict[str, Any],
    targets: dict[str, float],
    tolerances: dict[str, float],
    sample_size: int,
    seed: int,
    iterations: int,
    include_priority: bool,
    progress_cb: Callable[[str], None] | None = None,
) -> tuple[dict[str, Any], dict[str, float], float]:
    dims = [d["id"] for d in settings_data["dimensions"]]
    profiles = random_profiles(questions_data["questions"], dims, sample_size, seed)
    params, start_vector = build_tunable_params(results_data, include_priority=include_priority)

    if not params:
        ev = ResultEvaluator(settings_data, results_data)
        dist = ev.distribution(profiles)
        return copy.deepcopy(results_data), dist, objective_score(dist, targets, tolerances)

    cur_vec = start_vector[:]
    best_vec = cur_vec[:]
    best_score = float("inf")
    cur_score = float("inf")
    best_dist: dict[str, float] = {}
    rng = random.Random(seed + 999)
    start = time.perf_counter()

    for it in range(iterations):
        step_scale = max(0.15, 1.0 - (it / max(1, iterations)))
        cand_vec = cur_vec[:]
        mutations = 1 if rng.random() < 0.75 else 2
        for _ in range(mutations):
            p = params[rng.randrange(len(params))]
            delta = p.step * rng.choice([-1, 1]) * (1 + int(rng.random() * 3 * step_scale))
            # Apply by label index in vector through setter/getter.
            # Find current index once by binary search is not available; params are small enough to linear.
            for i, maybe in enumerate(params):
                if maybe is p:
                    new_val = cand_vec[i] + delta
                    cand_vec[i] = max(p.lo, min(p.hi, new_val))
                    break

        cand_results = apply_vector_to_results(results_data, params, cand_vec, include_priority)
        evaluator = ResultEvaluator(settings_data, cand_results)
        cand_dist = evaluator.distribution(profiles)
        cand_score = objective_score(cand_dist, targets, tolerances)

        accept = False
        if cand_score <= cur_score:
            accept = True
        else:
            temperature = max(0.01, 1.0 - (it / max(1, iterations)))
            uphill = cand_score - cur_score
            accept = rng.random() < math.exp(-uphill / max(0.0001, temperature))

        if accept:
            cur_vec = cand_vec
            cur_score = cand_score
            if cand_score < best_score:
                best_score = cand_score
                best_vec = cand_vec[:]
                best_dist = cand_dist

        if progress_cb and (it % max(1, iterations // 20) == 0 or it == iterations - 1):
            elapsed = time.perf_counter() - start
            progress_cb(f"iter {it+1}/{iterations} | best={best_score:.4f} | elapsed={elapsed:.1f}s")

    best_results = apply_vector_to_results(results_data, params, best_vec, include_priority)
    if not best_dist:
        evaluator = ResultEvaluator(settings_data, best_results)
        best_dist = evaluator.distribution(profiles)
        best_score = objective_score(best_dist, targets, tolerances)
    return best_results, best_dist, best_score


class GoalTunerUI:
    def __init__(self, root: tk.Tk, repo_root: Path) -> None:
        self.root = root
        self.repo_root = repo_root
        self.settings_path = repo_root / "data" / "settings.json"
        self.questions_path = repo_root / "data" / "questions.json"
        self.results_path = repo_root / "data" / "results.json"

        self.settings_data = load_json(self.settings_path)
        self.questions_data = load_json(self.questions_path)
        self.results_data = load_json(self.results_path)
        self.tuned_results_data: dict[str, Any] | None = None
        self.latest_dist: dict[str, float] = {}

        self.target_vars: dict[str, tk.StringVar] = {}
        self.tol_vars: dict[str, tk.StringVar] = {}
        self.enable_vars: dict[str, tk.BooleanVar] = {}
        self.current_labels: dict[str, ttk.Label] = {}
        self.tuned_labels: dict[str, ttk.Label] = {}

        self.sample_var = tk.StringVar(value="12000")
        self.seed_var = tk.StringVar(value="42")
        self.iter_var = tk.StringVar(value="450")
        self.priority_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="Ready")
        self.score_var = tk.StringVar(value="-")
        self.audit_window: tk.Toplevel | None = None
        self.audit_text: tk.Text | None = None
        self.audit_min_var = tk.StringVar(value="-3")
        self.audit_max_var = tk.StringVar(value="-1")

        self._build()
        self._populate_current_distribution()

    def _build(self) -> None:
        self.root.title("Result Percentage Goal Tuner")
        self.root.geometry("1120x760")

        top = ttk.Frame(self.root, padding=10)
        top.pack(fill=tk.X)

        ttk.Label(top, text="Samples").grid(row=0, column=0, sticky=tk.W, padx=4)
        ttk.Entry(top, textvariable=self.sample_var, width=10).grid(row=0, column=1, padx=4)
        ttk.Label(top, text="Iterations").grid(row=0, column=2, sticky=tk.W, padx=4)
        ttk.Entry(top, textvariable=self.iter_var, width=10).grid(row=0, column=3, padx=4)
        ttk.Label(top, text="Seed").grid(row=0, column=4, sticky=tk.W, padx=4)
        ttk.Entry(top, textvariable=self.seed_var, width=10).grid(row=0, column=5, padx=4)
        ttk.Checkbutton(top, text="Tune Priority", variable=self.priority_var).grid(row=0, column=6, padx=8, sticky=tk.W)

        ttk.Button(top, text="Refresh Current", command=self._populate_current_distribution).grid(row=0, column=7, padx=6)
        ttk.Button(top, text="Optimize", command=self._start_optimize).grid(row=0, column=8, padx=6)
        ttk.Button(top, text="Save Tuned results.json", command=self._save_tuned).grid(row=0, column=9, padx=6)
        ttk.Button(top, text="Weights Audit UI", command=self._open_audit_window).grid(row=0, column=10, padx=6)

        ttk.Label(top, text="Objective Score:").grid(row=1, column=0, sticky=tk.W, padx=4, pady=(8, 0))
        ttk.Label(top, textvariable=self.score_var).grid(row=1, column=1, sticky=tk.W, padx=4, pady=(8, 0))
        ttk.Label(top, textvariable=self.status_var).grid(row=1, column=2, columnspan=8, sticky=tk.W, padx=4, pady=(8, 0))

        body = ttk.Frame(self.root, padding=(10, 4, 10, 10))
        body.pack(fill=tk.BOTH, expand=True)

        canvas = tk.Canvas(body, highlightthickness=0)
        yscroll = ttk.Scrollbar(body, orient=tk.VERTICAL, command=canvas.yview)
        table = ttk.Frame(canvas)
        table.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=table, anchor="nw")
        canvas.configure(yscrollcommand=yscroll.set)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        yscroll.pack(side=tk.RIGHT, fill=tk.Y)

        headers = ["Enable", "Result ID", "Current %", "Target %", "Tolerance %", "Tuned %"]
        for c, h in enumerate(headers):
            ttk.Label(table, text=h, font=("", 10, "bold")).grid(row=0, column=c, sticky=tk.W, padx=6, pady=4)

        row = 1
        for result in self.results_data["results"]:
            rid = result["id"]
            self.enable_vars[rid] = tk.BooleanVar(value=True)
            self.target_vars[rid] = tk.StringVar(value="")
            self.tol_vars[rid] = tk.StringVar(value="0.35")

            ttk.Checkbutton(table, variable=self.enable_vars[rid]).grid(row=row, column=0, padx=6, sticky=tk.W)
            ttk.Label(table, text=rid).grid(row=row, column=1, sticky=tk.W, padx=6)
            cur_lbl = ttk.Label(table, text="-")
            cur_lbl.grid(row=row, column=2, sticky=tk.W, padx=6)
            self.current_labels[rid] = cur_lbl
            ttk.Entry(table, textvariable=self.target_vars[rid], width=10).grid(row=row, column=3, padx=6, sticky=tk.W)
            ttk.Entry(table, textvariable=self.tol_vars[rid], width=10).grid(row=row, column=4, padx=6, sticky=tk.W)
            tuned_lbl = ttk.Label(table, text="-")
            tuned_lbl.grid(row=row, column=5, sticky=tk.W, padx=6)
            self.tuned_labels[rid] = tuned_lbl
            row += 1

    def _parse_run_config(self) -> tuple[int, int, int]:
        samples = max(1000, int(self.sample_var.get()))
        iterations = max(50, int(self.iter_var.get()))
        seed = int(self.seed_var.get())
        return samples, iterations, seed

    def _targets(self) -> tuple[dict[str, float], dict[str, float]]:
        targets: dict[str, float] = {}
        tolerances: dict[str, float] = {}
        for result in self.results_data["results"]:
            rid = result["id"]
            if not self.enable_vars[rid].get():
                continue
            raw_target = self.target_vars[rid].get().strip()
            if not raw_target:
                continue
            try:
                target = float(raw_target)
                tol = float(self.tol_vars[rid].get().strip() or "0.35")
            except ValueError:
                continue
            targets[rid] = target
            tolerances[rid] = max(0.001, tol)
        return targets, tolerances

    def _populate_current_distribution(self) -> None:
        samples, _, seed = self._parse_run_config()
        dims = [d["id"] for d in self.settings_data["dimensions"]]
        profiles = random_profiles(self.questions_data["questions"], dims, samples, seed)
        ev = ResultEvaluator(self.settings_data, self.results_data)
        dist = ev.distribution(profiles)
        self.latest_dist = dist
        for rid, lbl in self.current_labels.items():
            pct = dist.get(rid, 0.0)
            lbl.configure(text=f"{pct:.3f}")
            if not self.target_vars[rid].get().strip():
                self.target_vars[rid].set(f"{pct:.3f}")
        self.status_var.set(f"Current distribution loaded from {samples} samples.")

    def _start_optimize(self) -> None:
        targets, tolerances = self._targets()
        if not targets:
            self.status_var.set("Set at least one target percentage.")
            return
        samples, iterations, seed = self._parse_run_config()
        include_priority = self.priority_var.get()
        self.status_var.set("Optimizing...")

        def progress(msg: str) -> None:
            self.root.after(0, lambda: self.status_var.set(msg))

        def run() -> None:
            try:
                tuned, dist, score = optimize(
                    settings_data=self.settings_data,
                    questions_data=self.questions_data,
                    results_data=self.results_data,
                    targets=targets,
                    tolerances=tolerances,
                    sample_size=samples,
                    seed=seed,
                    iterations=iterations,
                    include_priority=include_priority,
                    progress_cb=progress,
                )
            except Exception as exc:  # pragma: no cover - UI fallback
                self.root.after(0, lambda: self.status_var.set(f"Optimize failed: {exc}"))
                return

            def finish() -> None:
                self.tuned_results_data = tuned
                self.score_var.set(f"{score:.6f}")
                for rid, lbl in self.tuned_labels.items():
                    lbl.configure(text=f"{dist.get(rid, 0.0):.3f}")
                self.status_var.set("Optimization complete. Review tuned % and save if satisfied.")

            self.root.after(0, finish)

        threading.Thread(target=run, daemon=True).start()

    def _save_tuned(self) -> None:
        if not self.tuned_results_data:
            self.status_var.set("No tuned results yet. Run Optimize first.")
            return
        backup = self.results_path.with_suffix(".json.bak")
        save_json(backup, self.results_data)
        save_json(self.results_path, self.tuned_results_data)
        self.results_data = copy.deepcopy(self.tuned_results_data)
        self.status_var.set(f"Saved tuned config to {self.results_path}. Backup: {backup.name}")

    def _audit_stats(self) -> dict[str, Any]:
        dims = [d["id"] for d in self.settings_data["dimensions"]]
        per = {d: {"neg": 0, "pos": 0, "zero": 0, "sum": 0} for d in dims}
        neg_values: list[int] = []
        violations: list[tuple[str, int, str, int]] = []
        for q in self.questions_data["questions"]:
            qid = q.get("id", "?")
            for oi, opt in enumerate(q.get("options", []), start=1):
                w = opt.get("weights", {})
                for d in dims:
                    val = int(w.get(d, 0))
                    per[d]["sum"] += val
                    if val < 0:
                        per[d]["neg"] += 1
                        neg_values.append(val)
                        if val < -3 or val > -1:
                            violations.append((qid, oi, d, val))
                    elif val > 0:
                        per[d]["pos"] += 1
                    else:
                        per[d]["zero"] += 1
        return {
            "dims": dims,
            "per": per,
            "neg_values": neg_values,
            "violations": violations,
        }

    def _format_audit(self) -> str:
        s = self._audit_stats()
        per = s["per"]
        neg_values = s["neg_values"]
        violations = s["violations"]
        lines: list[str] = []
        lines.append("Weights Semantic Audit")
        lines.append("======================")
        lines.append("")
        lines.append(f"Negative count: {len(neg_values)}")
        if neg_values:
            lines.append(f"Negative min/max: {min(neg_values)} / {max(neg_values)}")
            freq: dict[int, int] = {}
            for v in neg_values:
                freq[v] = freq.get(v, 0) + 1
            lines.append(f"Negative freq: {dict(sorted(freq.items()))}")
        else:
            lines.append("Negative min/max: n/a")
            lines.append("Negative freq: {}")
        lines.append("")
        lines.append("Per-dimension:")
        for d in s["dims"]:
            p = per[d]
            lines.append(
                f"- {d}: pos={p['pos']} neg={p['neg']} zero={p['zero']} net_sum={p['sum']}"
            )
        lines.append("")
        lines.append("Band violations (expected negative band: -3..-1):")
        if not violations:
            lines.append("- none")
        else:
            for qid, oi, d, val in violations:
                lines.append(f"- {qid} option {oi} {d}={val}")
        return "\n".join(lines)

    def _refresh_audit_text(self) -> None:
        if not self.audit_text:
            return
        self.audit_text.configure(state=tk.NORMAL)
        self.audit_text.delete("1.0", tk.END)
        self.audit_text.insert("1.0", self._format_audit())
        self.audit_text.configure(state=tk.DISABLED)

    def _apply_negative_band_and_save(self) -> None:
        try:
            min_v = int(self.audit_min_var.get().strip())
            max_v = int(self.audit_max_var.get().strip())
        except ValueError:
            self.status_var.set("Audit: min/max must be integers.")
            return
        if min_v > max_v:
            self.status_var.set("Audit: min cannot be greater than max.")
            return
        if max_v >= 0:
            self.status_var.set("Audit: max must stay negative.")
            return

        changed = 0
        for q in self.questions_data["questions"]:
            for opt in q.get("options", []):
                w = opt.get("weights", {})
                for k, v in list(w.items()):
                    iv = int(v)
                    if iv < 0:
                        nv = max(min_v, min(max_v, iv))
                        if nv != iv:
                            w[k] = nv
                            changed += 1

        backup = self.questions_path.with_suffix(".json.bak")
        save_json(backup, load_json(self.questions_path))
        save_json(self.questions_path, self.questions_data)
        self._refresh_audit_text()
        self.status_var.set(
            f"Audit: enforced negative band [{min_v},{max_v}] and saved questions.json ({changed} edits)."
        )

    def _export_audit_markdown(self) -> None:
        report = self._format_audit()
        out = self.repo_root / "docs" / "weights_semantic_audit.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            f.write(report)
            f.write("\n")
        self.status_var.set(f"Audit report exported to {out}")

    def _open_audit_window(self) -> None:
        if self.audit_window and self.audit_window.winfo_exists():
            self.audit_window.focus_set()
            self._refresh_audit_text()
            return

        w = tk.Toplevel(self.root)
        w.title("Weights Semantic Audit")
        w.geometry("900x620")
        self.audit_window = w

        controls = ttk.Frame(w, padding=8)
        controls.pack(fill=tk.X)
        ttk.Label(controls, text="Neg Min").pack(side=tk.LEFT, padx=(0, 6))
        ttk.Entry(controls, textvariable=self.audit_min_var, width=6).pack(side=tk.LEFT)
        ttk.Label(controls, text="Neg Max").pack(side=tk.LEFT, padx=(12, 6))
        ttk.Entry(controls, textvariable=self.audit_max_var, width=6).pack(side=tk.LEFT)
        ttk.Button(controls, text="Refresh", command=self._refresh_audit_text).pack(side=tk.LEFT, padx=10)
        ttk.Button(controls, text="Enforce Band + Save", command=self._apply_negative_band_and_save).pack(
            side=tk.LEFT, padx=6
        )
        ttk.Button(controls, text="Export Markdown", command=self._export_audit_markdown).pack(side=tk.LEFT, padx=6)

        frame = ttk.Frame(w, padding=(8, 0, 8, 8))
        frame.pack(fill=tk.BOTH, expand=True)
        txt = tk.Text(frame, wrap=tk.NONE)
        yscroll = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=txt.yview)
        xscroll = ttk.Scrollbar(frame, orient=tk.HORIZONTAL, command=txt.xview)
        txt.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        yscroll.pack(side=tk.RIGHT, fill=tk.Y)
        xscroll.pack(side=tk.BOTTOM, fill=tk.X)
        self.audit_text = txt
        self._refresh_audit_text()


def quick_test(repo_root: Path) -> int:
    settings = load_json(repo_root / "data" / "settings.json")
    questions = load_json(repo_root / "data" / "questions.json")
    results = load_json(repo_root / "data" / "results.json")
    dims = [d["id"] for d in settings["dimensions"]]
    profiles = random_profiles(questions["questions"], dims, 5000, 42)
    ev = ResultEvaluator(settings, results)
    dist = ev.distribution(profiles)
    print("Quick distribution (5000 samples)")
    for rid, pct in sorted(dist.items(), key=lambda kv: kv[0]):
        print(f"{rid:24} {pct:7.3f}%")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive % goal tuner for results.json")
    parser.add_argument("--repo-root", default=".", help="Repository root path")
    parser.add_argument("--quick-test", action="store_true", help="Run a quick sampling test and exit")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if args.quick_test:
        return quick_test(repo_root)

    root = tk.Tk()
    GoalTunerUI(root, repo_root=repo_root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
