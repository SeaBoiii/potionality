const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const questionIndexEl = document.getElementById("questionIndex");
const questionImageEl = document.getElementById("questionImage");
const questionPromptEl = document.getElementById("questionPrompt");
const questionOptionsEl = document.getElementById("questionOptions");
const questionCardEl = document.getElementById("questionCard");
const progressFillEl = document.getElementById("progressFill");
const progressLabelEl = document.getElementById("progressLabel");
const dimensionListEl = document.getElementById("dimensionList");
const dimensionLegendEl = document.getElementById("dimensionLegend");
const resultCardEl = document.getElementById("resultCard");
const resetBtn = document.getElementById("resetBtn");
const liveProfileEl = document.getElementById("liveProfile");
const resultPanelEl = document.getElementById("resultPanel");
const restartBtn = document.getElementById("restartBtn");
const resultImageEl = document.getElementById("resultImage");
const soundToggleBtn = document.getElementById("soundToggleBtn");
const shareBtn = document.getElementById("shareBtn");
const shareLinkBtn = document.getElementById("shareLinkBtn");
const toggleDimensionsBtn = document.getElementById("toggleDimensionsBtn");
const dimensionPanelEl = document.getElementById("dimensionPanel");

const ingredientIcons = [
  "/assets/icons/leaf.svg",
  "/assets/icons/ember.svg",
  "/assets/icons/droplet.svg",
  "/assets/icons/flower.svg",
];

const state = {
  data: null,
  index: 0,
  scores: {},
  answers: [],
  finished: false,
  lastResult: null,
  soundEnabled: false,
  audioCtx: null,
  answeringLocked: false,
};
const preloadedImageUrls = new Set();

async function loadJson(path) {
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return resp.json();
}

async function loadData() {
  const [settings, results, questions] = await Promise.all([
    loadJson("data/settings.json"),
    loadJson("data/results.json"),
    loadJson("data/questions.json"),
  ]);
  return {
    ...settings,
    ...results,
    ...questions,
  };
}

function initScores(dimensions) {
  state.scores = {};
  dimensions.forEach((dim) => {
    state.scores[dim.id] = 0;
  });
}

function clamp(value, min = -24, max = 24) {
  return Math.max(min, Math.min(max, value));
}

function setResultPalette(palette) {
  const root = document.documentElement;
  if (!palette) return;
  if (palette.primary) root.style.setProperty("--result-primary", palette.primary);
  if (palette.secondary) root.style.setProperty("--result-secondary", palette.secondary);
  if (palette.accent) root.style.setProperty("--result-accent", palette.accent);
}

function setThemePalette(palette) {
  if (!palette) return;
  const root = document.documentElement;
  const primary = palette.primary || "#a9543d";
  const secondary = palette.secondary || "#efc08f";
  const accent = palette.accent || "#5b2b22";
  root.style.setProperty("--theme-top", secondary);
  root.style.setProperty("--theme-mid", primary);
  root.style.setProperty("--theme-bottom", accent);
  root.style.setProperty("--theme-glow", "rgba(203, 143, 96, 0.55)");
}

function resetThemePalette() {
  const root = document.documentElement;
  root.style.setProperty("--theme-top", "#f5e6cf");
  root.style.setProperty("--theme-mid", "#ecd9bd");
  root.style.setProperty("--theme-bottom", "#e2c8a8");
  root.style.setProperty("--theme-glow", "rgba(203, 143, 96, 0.45)");
}

function playChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const startTime = ctx.currentTime + 0.01;
    osc.frequency.setValueAtTime(520, startTime);
    osc.frequency.exponentialRampToValueAtTime(340, startTime + 0.12);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.15, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.22);
  } catch (error) {
    // ignore audio errors
  }
}

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

function getSortedScores() {
  return Object.entries(state.scores)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value);
}

function preloadImage(url) {
  if (!url || preloadedImageUrls.has(url)) return;
  preloadedImageUrls.add(url);
  const img = new Image();
  img.src = url;
}

function preloadNextQuestionAssets() {
  if (!state.data?.questions) return;
  const nextQuestion = state.data.questions[state.index + 1];
  if (!nextQuestion) return;
  preloadImage(nextQuestion.image);
  (nextQuestion.options || []).forEach((option) => preloadImage(option.image));
}

function setAnswerButtonsDisabled(disabled) {
  questionOptionsEl
    .querySelectorAll("button.option")
    .forEach((buttonEl) => {
      buttonEl.disabled = disabled;
      buttonEl.setAttribute("aria-disabled", disabled ? "true" : "false");
    });
}

function hideQuestionImage() {
  if (!questionImageEl) return;
  questionImageEl.classList.remove("is-loading", "is-ready");
  questionImageEl.removeAttribute("src");
  questionImageEl.style.display = "none";
}

function showQuestionImageWithLoading(src, altText) {
  if (!questionImageEl) return;
  questionImageEl.classList.remove("is-ready");
  questionImageEl.classList.add("is-loading");
  questionImageEl.alt = altText || "Question image";
  questionImageEl.style.display = "block";

  const finalize = () => {
    questionImageEl.classList.remove("is-loading");
    questionImageEl.classList.add("is-ready");
  };

  questionImageEl.onload = finalize;
  questionImageEl.onerror = () => {
    hideQuestionImage();
  };
  questionImageEl.src = src;
  if (questionImageEl.complete) {
    finalize();
  }
}

function buildResultShareUrl(resultId) {
  const url = new URL(window.location.href);
  if (resultId) {
    url.searchParams.set("result", resultId);
  } else {
    url.searchParams.delete("result");
  }
  const encodedScores = encodeScoresForUrl(state.scores);
  if (encodedScores) {
    url.searchParams.set("scores", encodedScores);
  } else {
    url.searchParams.delete("scores");
  }
  return url.toString();
}

function syncResultParam(resultId, scoreMap = null) {
  const url = new URL(window.location.href);
  if (resultId) {
    url.searchParams.set("result", resultId);
  } else {
    url.searchParams.delete("result");
  }
  const encodedScores = encodeScoresForUrl(scoreMap);
  if (encodedScores) {
    url.searchParams.set("scores", encodedScores);
  } else {
    url.searchParams.delete("scores");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function encodeScoresForUrl(scoreMap) {
  if (!scoreMap || !state.data?.dimensions?.length) return "";
  const normalized = {};
  state.data.dimensions.forEach((dim) => {
    const value = Number(scoreMap[dim.id]);
    normalized[dim.id] = Number.isFinite(value) ? clamp(Math.round(value), -10, 10) : 0;
  });
  return encodeURIComponent(JSON.stringify(normalized));
}

function decodeScoresFromUrl(rawValue) {
  if (!rawValue || !state.data?.dimensions?.length) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(rawValue));
    const restored = {};
    state.data.dimensions.forEach((dim) => {
      const value = Number(parsed?.[dim.id]);
      restored[dim.id] = Number.isFinite(value) ? clamp(Math.round(value), -10, 10) : 0;
    });
    return restored;
  } catch (error) {
    return null;
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

function showToast(message, isError = false) {
  const existing = document.querySelector(".toast");
  if (existing) {
    existing.remove();
  }
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " is-error" : ""}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 180);
  }, 1400);
}

async function copyResultLink() {
  if (!state.lastResult?.id || !shareLinkBtn) return;
  const shareUrl = buildResultShareUrl(state.lastResult.id);
  const copied = await copyTextToClipboard(shareUrl);
  showToast(copied ? "Link copied" : "Copy failed", !copied);
}

function showResultPanel() {
  if (questionCardEl) {
    questionCardEl.classList.add("is-hidden");
  }
  if (resultPanelEl) {
    resultPanelEl.classList.remove("is-hidden");
    resultPanelEl.classList.remove("is-visible");
    requestAnimationFrame(() => {
      resultPanelEl.classList.add("is-visible");
    });
  }
}

function showSharedResultFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const resultId = params.get("result");
  if (!resultId) return false;
  const directResult = state.data.results.find((result) => result.id === resultId);
  if (!directResult) return false;
  const restoredScores = decodeScoresFromUrl(params.get("scores"));
  if (restoredScores) {
    state.scores = restoredScores;
  }

  state.finished = true;
  renderResult(directResult);
  renderDimensions();
  if (dimensionPanelEl) {
    dimensionPanelEl.classList.add("is-hidden");
  }
  if (toggleDimensionsBtn) {
    toggleDimensionsBtn.textContent = "Show Analysis";
  }
  showResultPanel();
  return true;
}

function meetsCondition(cond) {
  if (!cond) return true;
  // Backward-compatible condition format: { dim, min/max } or { dim, op, value }
  if (cond.dim && !cond.type) {
    const value = state.scores[cond.dim] ?? 0;
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
  const scoreMap = state.scores || {};

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
      return (scoreMap[a] ?? 0) > (scoreMap[b] ?? 0) + value;
    }
    case "diff_abs_lte": {
      const a = cond.a;
      const b = cond.b;
      return Math.abs((scoreMap[a] ?? 0) - (scoreMap[b] ?? 0)) <= value;
    }
    case "top_is": {
      const sorted = getSortedScores();
      return sorted[0]?.id === cond.dim;
    }
    case "not_top_is": {
      const sorted = getSortedScores();
      return sorted[0]?.id !== cond.dim;
    }
    case "rank_is": {
      const sorted = getSortedScores();
      const rank = Math.max(1, Number(cond.rank) || 1);
      return sorted[rank - 1]?.id === cond.dim;
    }
    case "top_diff_gte": {
      const sorted = getSortedScores();
      const top = sorted[0]?.value ?? 0;
      const second = sorted[1]?.value ?? 0;
      return top - second >= value;
    }
    case "top_diff_lte": {
      const sorted = getSortedScores();
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

function resultMatchesConditions(result) {
  const conditions = result.conditions || [];
  if (!conditions.length) return true;
  return conditions.every(meetsCondition);
}

function resolveConditionalResult() {
  const candidates = state.data.results.filter((result) =>
    resultMatchesConditions(result)
  );
  if (!candidates.length) return null;
  let best = null;
  let bestPriority = -Infinity;
  candidates.forEach((result, index) => {
    const priority = Number.isFinite(result.priority) ? result.priority : 0;
    if (priority > bestPriority) {
      best = result;
      bestPriority = priority;
      return;
    }
    if (priority === bestPriority && best) {
      const bestIndex = state.data.results.indexOf(best);
      if (index < bestIndex) {
        best = result;
      }
    } else if (priority === bestPriority && !best) {
      best = result;
    }
  });
  return best;
}

function computeResult() {
  const scoreValues = Object.values(state.scores);
  const total = scoreValues.reduce((sum, val) => sum + Math.abs(val), 0);
  const signal = total > 18 ? "High signal" : total > 10 ? "Moderate signal" : "Soft signal";

  const conditional = resolveConditionalResult();
  if (conditional) {
    const summary = conditional.summary || "";
    return {
      ...conditional,
    summary,
    extra: conditional.extra || "",
  };
}

  const dominant = Object.entries(state.scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([id]) => id);

  const defaultResult = state.data.results.find((r) => r.id === "potion_calm") ||
    state.data.results[0];

  if (!dominant.length) {
    return { ...defaultResult, extra: signal };
  }

  const top = dominant[0];
  const secondary = dominant[1];

  const fallbackMap = {
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
  let resolved = mappedId
    ? state.data.results.find((r) => r.id === mappedId)
    : defaultResult;

  if (!resolved) {
    resolved = defaultResult;
  }

  const summary = resolved ? resolved.summary : "";
  return {
    ...(resolved || defaultResult),
    summary,
    extra: `Dominant: ${top}${secondary ? `, Secondary: ${secondary}` : ""}`,
  };
}

function updateProfile() {
  if (!liveProfileEl) return;
  const top = Object.entries(state.scores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([id, val]) => `${id} ${val > 0 ? "↑" : "↓"}`)
    .join(" · ");
  liveProfileEl.textContent = top ? `Current leaning: ${top}` : "Answer a few questions to see your shape.";
}

function renderDimensions() {
  if (!dimensionListEl) return;
  dimensionListEl.innerHTML = "";
  if (dimensionLegendEl) {
    dimensionLegendEl.innerHTML = "";
  }
  state.data.dimensions.forEach((dim) => {
    const wrapper = document.createElement("div");
    wrapper.className = "dimension";

    const label = document.createElement("div");
    label.className = "dimension__label";
    const left = document.createElement("span");
    left.textContent = dim.left;
    const center = document.createElement("span");
    center.textContent = dim.label;
    const right = document.createElement("span");
    right.textContent = dim.right;
    label.appendChild(left);
    label.appendChild(center);
    label.appendChild(right);

    const track = document.createElement("div");
    track.className = "dimension__track";
    const fill = document.createElement("div");
    fill.className = "dimension__fill";

    const raw = clamp(state.scores[dim.id] || 0, -24, 24);
    const pct = ((raw + 24) / 48) * 100;
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    wrapper.appendChild(label);
    wrapper.appendChild(track);
    dimensionListEl.appendChild(wrapper);

    if (dimensionLegendEl && dim.description) {
      const legendItem = document.createElement("div");
      legendItem.className = "dimension-legend__item";
      const name = document.createElement("span");
      name.className = "dimension-legend__name";
      name.textContent = dim.label;
      const description = document.createElement("span");
      description.className = "dimension-legend__desc";
      description.textContent = dim.description;
      legendItem.appendChild(name);
      legendItem.appendChild(description);
      dimensionLegendEl.appendChild(legendItem);
    }
  });
}

function renderQuestion() {
  const question = state.data.questions[state.index];
  if (!question) return;
  state.answeringLocked = false;
  questionIndexEl.textContent = `Question ${state.index + 1}`;
  if (questionImageEl) {
    if (question.image) {
      showQuestionImageWithLoading(question.image, question.prompt);
    } else {
      hideQuestionImage();
    }
  }
  questionPromptEl.textContent = question.prompt;
  questionOptionsEl.innerHTML = "";
  const ingredientIcon = ingredientIcons[state.index % ingredientIcons.length];
  if (progressFillEl) {
    progressFillEl.style.setProperty("--ingredient-url", `url('${ingredientIcon}')`);
  }
  question.options.forEach((option, optionIndex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    const media = document.createElement("span");
    media.className = "option__media";
    if (option.image) {
      const img = document.createElement("img");
      img.src = option.image;
      img.alt = option.text || "Option image";
      media.appendChild(img);
    }

    const text = document.createElement("span");
    text.className = "option__text";
    text.textContent = option.text;

    btn.appendChild(media);
    btn.appendChild(text);
    btn.addEventListener("click", () => {
      if (state.answeringLocked) return;
      state.answeringLocked = true;
      setAnswerButtonsDisabled(true);
      btn.classList.add("is-selected");
      playChime();
      applyAnswer(question, option, optionIndex);
    });
    questionOptionsEl.appendChild(btn);
  });
  preloadNextQuestionAssets();
}

function applyAnswer(question, option, optionIndex) {
  Object.entries(option.weights || {}).forEach(([dimId, delta]) => {
    state.scores[dimId] = clamp((state.scores[dimId] || 0) + delta, -20, 20);
  });
  state.answers[state.index] = optionIndex;
  if (state.index < state.data.questions.length - 1) {
    if (questionCardEl) {
      questionCardEl.classList.add("is-transitioning", "is-brewing");
    }
    setTimeout(() => {
      state.index += 1;
      renderQuestion();
      updateProgress();
      updateProfile();
      if (questionCardEl) {
        questionCardEl.classList.remove("is-transitioning", "is-brewing");
      }
      state.answeringLocked = false;
      setAnswerButtonsDisabled(false);
    }, 350);
    return;
  }
  state.finished = true;
  updateProgress();
  updateProfile();
  renderResult();
  renderDimensions();
  if (dimensionPanelEl) {
    dimensionPanelEl.classList.add("is-hidden");
  }
  if (toggleDimensionsBtn) {
    toggleDimensionsBtn.textContent = "Show Analysis";
  }
  showResultPanel();
}

function updateProgress() {
  const total = state.data.questions.length;
  const current = Math.min(state.answers.length, total);
  const pct = total ? (current / total) * 100 : 0;
  progressFillEl.style.width = `${pct}%`;
  progressLabelEl.textContent = `${current} / ${total}`;
}

function renderResult(overrideResult = null) {
  const result = overrideResult || computeResult();
  if (!resultCardEl) return;
  setResultPalette(result.palette);
  setThemePalette(result.palette);
  state.lastResult = result;
  syncResultParam(result.id, state.scores);
  if (resultImageEl) {
    if (result.image) {
      resultImageEl.src = result.image;
      resultImageEl.alt = result.title || "Potion image";
      resultImageEl.style.display = "block";
    } else {
      resultImageEl.removeAttribute("src");
      resultImageEl.style.display = "none";
    }
  }
  resultCardEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "result__title";
  title.textContent = result.title;

  const summary = document.createElement("div");
  summary.className = "result__summary";
  summary.textContent = result.summary;

  const lore = document.createElement("div");
  lore.className = "result__lore";
  lore.textContent = result.lore || "";

  const label = document.createElement("div");
  label.className = "result__label";

  const labelItems = [
    { key: "Side Effect", value: result.side_effect },
    { key: "Signature Ritual", value: result.signature_ritual },
  ];

  labelItems.forEach((item) => {
    if (!item.value) return;
    const row = document.createElement("div");
    row.className = "result__label-row";
    const name = document.createElement("span");
    name.className = "result__label-key";
    name.textContent = item.key;
    const value = document.createElement("span");
    value.className = "result__label-value";
    value.textContent = item.value;
    row.appendChild(name);
    row.appendChild(value);
    label.appendChild(row);
  });

  const notes = result.tasting_notes;
  if (notes && typeof notes === "object") {
    const notesRow = document.createElement("div");
    notesRow.className = "result__label-row";
    const name = document.createElement("span");
    name.className = "result__label-key";
    name.textContent = "Tasting Notes";
    const value = document.createElement("div");
    value.className = "result__label-notes";

    const noteItems = [
      { key: "Top", value: notes.top },
      { key: "Mid", value: notes.mid },
      { key: "Base", value: notes.base },
    ].filter((item) => item.value);

    noteItems.forEach((item) => {
      const pill = document.createElement("span");
      pill.className = "result__note";
      pill.textContent = `${item.key}: ${item.value}`;
      value.appendChild(pill);
    });

    notesRow.appendChild(name);
    notesRow.appendChild(value);
    label.appendChild(notesRow);
  }

  const signals = document.createElement("ul");
  signals.className = "result__signals";
  (result.signals || []).forEach((signal) => {
    const item = document.createElement("li");
    item.textContent = signal;
    signals.appendChild(item);
  });

  const extra = document.createElement("div");
  extra.className = "result__summary";
  extra.textContent = result.extra;

  resultCardEl.appendChild(title);
  resultCardEl.appendChild(summary);
  resultCardEl.appendChild(lore);
  if (extra.textContent) {
    resultCardEl.appendChild(extra);
  }
  if (label.children.length) {
    resultCardEl.appendChild(label);
  }
  resultCardEl.appendChild(signals);
}

function reset() {
  state.index = 0;
  state.finished = false;
  state.answeringLocked = false;
  state.answers = [];
  initScores(state.data.dimensions);
  renderQuestion();
  updateProgress();
  updateProfile();
  resultCardEl.innerHTML = "";
  state.lastResult = null;
  syncResultParam(null, null);
  resetThemePalette();
  if (dimensionListEl) {
    dimensionListEl.innerHTML = "";
  }
  if (dimensionPanelEl) {
    dimensionPanelEl.classList.add("is-hidden");
  }
  if (toggleDimensionsBtn) {
    toggleDimensionsBtn.textContent = "Show Analysis";
  }
  if (resultPanelEl) {
    resultPanelEl.classList.add("is-hidden");
    resultPanelEl.classList.remove("is-visible");
  }
  if (questionCardEl) {
    questionCardEl.classList.remove("is-hidden");
  }
}

function downloadShareCard() {
  if (!state.lastResult) return;
  const result = state.lastResult;
  const canvas = document.createElement("canvas");
  const width = 1080;
  const height = 1240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const primary = result.palette?.primary || "#a9543d";
  const secondary = result.palette?.secondary || "#efc08f";
  const accent = result.palette?.accent || "#5b2b22";

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, secondary);
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cardX = 70;
  const cardY = 70;
  const cardW = width - 140;
  const cardH = height - 140;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.strokeRect(cardX + 6, cardY + 6, cardW - 12, cardH - 12);

  ctx.fillStyle = accent;
  ctx.font = "600 42px 'Cormorant Garamond', serif";
  ctx.fillText("If You Were a Potion", cardX + 60, cardY + 110);

  ctx.fillStyle = primary;
  ctx.font = "700 68px 'Cormorant Garamond', serif";
  wrapText(ctx, result.title || "Your Potion", cardX + 60, cardY + 200, cardW - 120, 72);

  const imageWidth = 330;
  const imageHeight = 620;
  const imageX = cardX + cardW - imageWidth - 70;
  const imageY = cardY + 260;

  ctx.fillStyle = "#2a211d";
  ctx.font = "26px Mulish, sans-serif";
  const summaryStartY = cardY + 300;
  const summaryHeight = wrapText(
    ctx,
    result.summary || "",
    cardX + 60,
    summaryStartY,
    cardW - imageWidth - 150,
    38
  );

  ctx.fillStyle = "#5a4c45";
  ctx.font = "22px Mulish, sans-serif";
  const loreStartY = summaryStartY + summaryHeight + 64;
  wrapText(
    ctx,
    result.lore || "",
    cardX + 60,
    loreStartY,
    cardW - imageWidth - 150,
    34
  );

  ctx.fillStyle = accent;
  ctx.font = "600 20px Mulish, sans-serif";
  const paletteY = cardY + cardH - 170;
  ctx.fillText("Palette", cardX + 60, paletteY);

  ctx.fillStyle = primary;
  ctx.fillRect(cardX + 60, paletteY + 30, 220, 16);
  ctx.fillStyle = secondary;
  ctx.fillRect(cardX + 60, paletteY + 60, 220, 16);
  ctx.fillStyle = accent;
  ctx.fillRect(cardX + 60, paletteY + 90, 220, 16);

  if (result.image) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 10;
      const maxW = imageWidth;
      const maxH = imageHeight;
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const drawW = img.width * ratio;
      const drawH = img.height * ratio;
      const drawX = imageX + (maxW - drawW) / 2;
      const drawY = imageY + (maxH - drawH) / 2;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();
      const link = document.createElement("a");
      link.download = "potion-result.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.onerror = () => {
      const link = document.createElement("a");
      link.download = "potion-result.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = result.image;
  } else {
    const link = document.createElement("a");
    link.download = "potion-result.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, measureOnly = false) {
  const words = text.split(" ");
  let line = "";
  let offsetY = y;
  let drawnLines = 0;
  words.forEach((word) => {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      if (!measureOnly) {
        ctx.fillText(line, x, offsetY);
      }
      line = `${word} `;
      offsetY += lineHeight;
      drawnLines += 1;
    } else {
      line = test;
    }
  });
  if (line) {
    if (!measureOnly) {
      ctx.fillText(line, x, offsetY);
    }
    drawnLines += 1;
  }
  return Math.max(lineHeight, drawnLines * lineHeight);
}

async function init() {
  try {
    state.data = await loadData();
  } catch (error) {
    questionPromptEl.textContent = "Could not load questions.";
    return;
  }
  titleEl.textContent = state.data.title;
  subtitleEl.textContent = state.data.subtitle;
  initScores(state.data.dimensions);
  if (showSharedResultFromUrl()) {
    return;
  }
  renderQuestion();
  updateProgress();
  updateProfile();
}

resetBtn.addEventListener("click", reset);
if (restartBtn) {
  restartBtn.addEventListener("click", reset);
}
if (soundToggleBtn) {
  soundToggleBtn.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    soundToggleBtn.textContent = state.soundEnabled ? "Sound: On" : "Sound: Off";
    if (state.soundEnabled) {
      getAudioContext();
      playChime();
    }
  });
}
if (shareBtn) {
  shareBtn.addEventListener("click", downloadShareCard);
}
if (shareLinkBtn) {
  shareLinkBtn.addEventListener("click", copyResultLink);
}
if (toggleDimensionsBtn) {
  toggleDimensionsBtn.addEventListener("click", () => {
    if (!dimensionPanelEl) return;
    const willShow = dimensionPanelEl.classList.contains("is-hidden");
    dimensionPanelEl.classList.toggle("is-hidden", !willShow);
    toggleDimensionsBtn.textContent = willShow ? "Hide Analysis" : "Show Analysis";
  });
}

init();
