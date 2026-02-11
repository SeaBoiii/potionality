import type {
  Dimension,
  ResultCondition,
  ResultProfile,
  ScoreMap,
  SharedStateV1,
} from "../types";

export function clamp(value: number, min = -24, max = 24): number {
  return Math.max(min, Math.min(max, value));
}

export function createInitialScores(dimensions: Dimension[]): ScoreMap {
  return dimensions.reduce<ScoreMap>((acc, dim) => {
    acc[dim.id] = 0;
    return acc;
  }, {});
}

export function normalizeScoresForDimensions(
  input: ScoreMap | null | undefined,
  dimensions: Dimension[],
  min = -20,
  max = 20
): ScoreMap {
  const normalized: ScoreMap = {};
  dimensions.forEach((dim) => {
    const value = Number(input?.[dim.id]);
    normalized[dim.id] = Number.isFinite(value)
      ? clamp(Math.round(value), min, max)
      : 0;
  });
  return normalized;
}

export function getSortedScores(scoreMap: ScoreMap): Array<{ id: string; value: number }> {
  return Object.entries(scoreMap)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value);
}

function meetsCondition(cond: ResultCondition | undefined, scoreMap: ScoreMap): boolean {
  if (!cond) {
    return true;
  }

  if (cond.dim && !cond.type) {
    const value = scoreMap[cond.dim] ?? 0;
    if (cond.min !== undefined || cond.max !== undefined) {
      const min = cond.min ?? -Infinity;
      const max = cond.max ?? Infinity;
      return value >= min && value <= max;
    }

    const op = cond.op || "gte";
    const target = cond.value ?? 0;
    switch (op) {
      case "gt":
        return value > target;
      case "lt":
        return value < target;
      case "lte":
        return value <= target;
      case "eq":
        return value === target;
      case "gte":
      default:
        return value >= target;
    }
  }

  const type = cond.type;
  const dim = cond.dim || "calm";
  const value = cond.value ?? 0;

  switch (type) {
    case "min":
      return (scoreMap[dim] ?? 0) >= value;
    case "max_le":
      return (scoreMap[dim] ?? 0) <= value;
    case "max_ge":
      return (scoreMap[dim] ?? 0) >= value;
    case "diff_greater": {
      const a = cond.a;
      const b = cond.b;
      if (!a || !b) {
        return false;
      }
      return (scoreMap[a] ?? 0) > (scoreMap[b] ?? 0) + value;
    }
    case "diff_abs_lte": {
      const a = cond.a;
      const b = cond.b;
      if (!a || !b) {
        return false;
      }
      return Math.abs((scoreMap[a] ?? 0) - (scoreMap[b] ?? 0)) <= value;
    }
    case "top_is": {
      const sorted = getSortedScores(scoreMap);
      return sorted[0]?.id === cond.dim;
    }
    case "not_top_is": {
      const sorted = getSortedScores(scoreMap);
      return sorted[0]?.id !== cond.dim;
    }
    case "rank_is": {
      const sorted = getSortedScores(scoreMap);
      const rank = Math.max(1, Number(cond.rank) || 1);
      return sorted[rank - 1]?.id === cond.dim;
    }
    case "top_diff_gte": {
      const sorted = getSortedScores(scoreMap);
      const top = sorted[0]?.value ?? 0;
      const second = sorted[1]?.value ?? 0;
      return top - second >= value;
    }
    case "top_diff_lte": {
      const sorted = getSortedScores(scoreMap);
      const top = sorted[0]?.value ?? 0;
      const second = sorted[1]?.value ?? 0;
      return top - second <= value;
    }
    case "total_min": {
      const total = Object.values(scoreMap).reduce((sum, val) => sum + val, 0);
      return total >= value;
    }
    case "total_max": {
      const total = Object.values(scoreMap).reduce((sum, val) => sum + val, 0);
      return total <= value;
    }
    case "sum_min": {
      const dims = Array.isArray(cond.dims) ? cond.dims : [];
      const sum = dims.reduce((acc, id) => acc + (scoreMap[id] ?? 0), 0);
      return sum >= value;
    }
    case "sum_max": {
      const dims = Array.isArray(cond.dims) ? cond.dims : [];
      const sum = dims.reduce((acc, id) => acc + (scoreMap[id] ?? 0), 0);
      return sum <= value;
    }
    case "spread_between": {
      const values = Object.values(scoreMap);
      const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
      const min = cond.min ?? 0;
      const max = cond.max ?? Infinity;
      return spread >= min && spread <= max;
    }
    default:
      return true;
  }
}

function resultMatchesConditions(result: ResultProfile, scoreMap: ScoreMap): boolean {
  const conditions = result.conditions || [];
  if (!conditions.length) {
    return true;
  }
  return conditions.every((cond) => meetsCondition(cond, scoreMap));
}

function resolveConditionalResult(results: ResultProfile[], scoreMap: ScoreMap): ResultProfile | null {
  const candidates = results.filter((result) => resultMatchesConditions(result, scoreMap));

  if (!candidates.length) {
    return null;
  }

  let best: ResultProfile | null = null;
  let bestPriority = -Infinity;

  candidates.forEach((result, index) => {
    const priority = Number.isFinite(result.priority) ? Number(result.priority) : 0;

    if (priority > bestPriority) {
      best = result;
      bestPriority = priority;
      return;
    }

    if (priority === bestPriority && best) {
      const bestIndex = results.indexOf(best);
      if (index < bestIndex) {
        best = result;
      }
    } else if (priority === bestPriority && !best) {
      best = result;
    }
  });

  return best;
}

export function computeResult(results: ResultProfile[], scoreMap: ScoreMap): ResultProfile {
  const scoreValues = Object.values(scoreMap);
  const total = scoreValues.reduce((sum, val) => sum + Math.abs(val), 0);
  const signal = total > 18 ? "High signal" : total > 10 ? "Moderate signal" : "Soft signal";

  const conditional = resolveConditionalResult(results, scoreMap);
  if (conditional) {
    const summary = conditional.summary || "";
    return {
      ...conditional,
      summary,
      extra: (conditional.extra as string | undefined) || "",
    };
  }

  const dominant = Object.entries(scoreMap)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([id]) => id);

  const defaultResult =
    results.find((result) => result.id === "potion_calm") ||
    results[0] || {
      id: "fallback",
      title: "Your Potion",
      summary: "",
      lore: "",
      signals: [],
    };

  if (!dominant.length) {
    return { ...defaultResult, extra: signal };
  }

  const top = dominant[0];
  const secondary = dominant[1];

  const fallbackMap: Record<string, string> = {
    calm: "potion_top_calm",
    courage: "potion_top_courage",
    focus: "potion_top_focus",
    charm: "potion_top_charm",
    tempo: "potion_top_tempo",
    insight: "potion_top_insight",
    resolve: "potion_top_resolve",
    wonder: "potion_top_wonder",
  };

  const mappedId = fallbackMap[top];
  const resolved =
    (mappedId ? results.find((result) => result.id === mappedId) : undefined) || defaultResult;

  return {
    ...resolved,
    summary: resolved.summary || "",
    extra: `Dominant: ${top}${secondary ? `, Secondary: ${secondary}` : ""}`,
  };
}

export function encodeLegacyScoresForUrl(scoreMap: ScoreMap, dimensions: Dimension[]): string {
  const normalized = normalizeScoresForDimensions(scoreMap, dimensions, -10, 10);
  return encodeURIComponent(JSON.stringify(normalized));
}

export function decodeLegacyScoresFromUrl(
  rawValue: string | null,
  dimensions: Dimension[]
): ScoreMap | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(rawValue)) as ScoreMap;
    return normalizeScoresForDimensions(parsed, dimensions, -10, 10);
  } catch {
    return null;
  }
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return atob(`${padded}${"=".repeat(padLen)}`);
}

export function encodeShareState(payload: SharedStateV1): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShareState(rawValue: string | null): SharedStateV1 | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(rawValue)) as SharedStateV1;
    if (parsed?.v !== 1 || typeof parsed.resultId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildLiveProfileText(scoreMap: ScoreMap): string {
  const top = Object.entries(scoreMap)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([id, value]) => `${id} ${value > 0 ? "↑" : "↓"}`)
    .join(" · ");

  return top ? `Current leaning: ${top}` : "Answer a few questions to see your shape.";
}
