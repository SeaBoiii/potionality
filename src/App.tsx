import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "../assets/css/style.css";
import {
  buildLiveProfileText,
  clamp,
  computeResult,
  createInitialScores,
  decodeLegacyScoresFromUrl,
  decodeShareState,
  encodeLegacyScoresForUrl,
  encodeShareState,
  normalizeScoresForDimensions,
} from "./lib/quiz";
import type {
  Dimension,
  QuestionOption,
  QuizData,
  ResultProfile,
  ResultsData,
  ScoreMap,
  SettingsData,
  SharedStateV1,
  QuestionsData,
} from "./types";

const ingredientIcons = [
  "assets/icons/leaf.svg",
  "assets/icons/ember.svg",
  "assets/icons/droplet.svg",
  "assets/icons/flower.svg",
];

const absoluteUrlPattern = /^(?:[a-z]+:)?\/\//i;

type ToastState = {
  message: string;
  isError: boolean;
};

type RestoredState = {
  result: ResultProfile;
  scores: ScoreMap;
  answers: number[];
};

function resolveAssetUrl(path: string | undefined): string {
  if (!path) {
    return "";
  }

  if (absoluteUrlPattern.test(path) || path.startsWith("data:")) {
    return path;
  }

  const trimmed = path.replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${trimmed}`;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveAssetUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return (await response.json()) as T;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function restoreFromUrl(data: QuizData): RestoredState | null {
  const params = new URLSearchParams(window.location.search);

  const sharedState = decodeShareState(params.get("state"));
  if (sharedState?.resultId) {
    const result = data.results.find((item) => item.id === sharedState.resultId);
    if (result) {
      const scores = normalizeScoresForDimensions(sharedState.scores, data.dimensions, -20, 20);
      const answers = Array.isArray(sharedState.answers)
        ? sharedState.answers
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0)
        : [];

      return { result, scores, answers };
    }
  }

  const resultId = params.get("result");
  if (!resultId) {
    return null;
  }

  const directResult = data.results.find((result) => result.id === resultId);
  if (!directResult) {
    return null;
  }

  const restoredScores =
    decodeLegacyScoresFromUrl(params.get("scores"), data.dimensions) ||
    createInitialScores(data.dimensions);

  return {
    result: directResult,
    scores: restoredScores,
    answers: [],
  };
}

function updateUrlState(
  resultId: string | null,
  scoreMap: ScoreMap | null,
  answers: number[] | null,
  dimensions: Dimension[]
): void {
  const url = new URL(window.location.href);

  if (!resultId || !scoreMap) {
    url.searchParams.delete("state");
    url.searchParams.delete("result");
    url.searchParams.delete("scores");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return;
  }

  const legacyScores = encodeLegacyScoresForUrl(scoreMap, dimensions);
  const sharedPayload: SharedStateV1 = {
    v: 1,
    resultId,
    scores: normalizeScoresForDimensions(scoreMap, dimensions, -20, 20),
    answers: Array.isArray(answers) ? answers : [],
  };

  url.searchParams.set("state", encodeShareState(sharedPayload));
  url.searchParams.set("result", resultId);
  url.searchParams.set("scores", legacyScores);

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function buildResultShareUrl(
  resultId: string,
  scoreMap: ScoreMap,
  answers: number[],
  dimensions: Dimension[]
): string {
  const url = new URL(window.location.href);

  const legacyScores = encodeLegacyScoresForUrl(scoreMap, dimensions);
  const sharedPayload: SharedStateV1 = {
    v: 1,
    resultId,
    scores: normalizeScoresForDimensions(scoreMap, dimensions, -20, 20),
    answers,
  };

  url.searchParams.set("state", encodeShareState(sharedPayload));
  url.searchParams.set("result", resultId);
  url.searchParams.set("scores", legacyScores);

  return url.toString();
}

function setResultPalette(palette: ResultProfile["palette"] | undefined): void {
  if (!palette) {
    return;
  }

  const root = document.documentElement;
  if (palette.primary) {
    root.style.setProperty("--result-primary", palette.primary);
  }
  if (palette.secondary) {
    root.style.setProperty("--result-secondary", palette.secondary);
  }
  if (palette.accent) {
    root.style.setProperty("--result-accent", palette.accent);
  }
}

function setThemePalette(palette: ResultProfile["palette"] | undefined): void {
  if (!palette) {
    return;
  }

  const root = document.documentElement;
  const primary = palette.primary || "#a9543d";
  const secondary = palette.secondary || "#efc08f";
  const accent = palette.accent || "#5b2b22";

  root.style.setProperty("--theme-top", secondary);
  root.style.setProperty("--theme-mid", primary);
  root.style.setProperty("--theme-bottom", accent);
  root.style.setProperty("--theme-glow", "rgba(203, 143, 96, 0.55)");
}

function resetThemePalette(): void {
  const root = document.documentElement;
  root.style.setProperty("--theme-top", "#f5e6cf");
  root.style.setProperty("--theme-mid", "#ecd9bd");
  root.style.setProperty("--theme-bottom", "#e2c8a8");
  root.style.setProperty("--theme-glow", "rgba(203, 143, 96, 0.45)");
  root.style.setProperty("--result-primary", "#a9543d");
  root.style.setProperty("--result-secondary", "#efc08f");
  root.style.setProperty("--result-accent", "#5b2b22");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
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
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  measureOnly = false
): number {
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

function App() {
  const [data, setData] = useState<QuizData | null>(null);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<ScoreMap>({});
  const [answers, setAnswers] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [lastResult, setLastResult] = useState<ResultProfile | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [answeringLocked, setAnsweringLocked] = useState(false);
  const [questionTransitioning, setQuestionTransitioning] = useState(false);
  const [questionBrewing, setQuestionBrewing] = useState(false);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [showDimensions, setShowDimensions] = useState(false);
  const [resultPanelHidden, setResultPanelHidden] = useState(true);
  const [resultPanelVisible, setResultPanelVisible] = useState(false);
  const [questionImageStatus, setQuestionImageStatus] = useState<"hidden" | "loading" | "ready">(
    "hidden"
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preloadedImageUrlsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const transitionTimeoutRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const toastRemoveTimeoutRef = useRef<number | null>(null);
  const resultPanelRafRef = useRef<number | null>(null);

  const totalQuestions = data?.questions.length || 0;
  const answeredCount = Math.min(answers.filter((value) => Number.isInteger(value)).length, totalQuestions);
  const progressPct = totalQuestions ? (answeredCount / totalQuestions) * 100 : 0;
  const remainingCount = Math.max(totalQuestions - answeredCount, 0);
  const progressHint = finished
    ? "Elixir complete. Your profile has stabilized."
    : remainingCount === 0
      ? "Final blend ready. Reveal your potion."
      : `${remainingCount} brew step${remainingCount === 1 ? "" : "s"} remaining`;
  const currentQuestion = data?.questions[index] || null;

  const ingredientIcon = resolveAssetUrl(ingredientIcons[index % ingredientIcons.length]);

  const progressFillStyle: CSSProperties = {
    width: `${progressPct}%`,
  };
  (progressFillStyle as Record<string, string>)["--ingredient-url"] = `url('${ingredientIcon}')`;

  const liveProfile = useMemo(() => buildLiveProfileText(scores), [scores]);

  const resultNoteItems = useMemo(() => {
    if (!lastResult?.tasting_notes || typeof lastResult.tasting_notes !== "object") {
      return [] as Array<{ key: string; value: string }>;
    }

    const notes = lastResult.tasting_notes;
    return [
      { key: "Top", value: toText(notes.top) },
      { key: "Mid", value: toText(notes.mid) },
      { key: "Base", value: toText(notes.base) },
    ].filter((item) => item.value);
  }, [lastResult]);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }

    if (toastRemoveTimeoutRef.current !== null) {
      window.clearTimeout(toastRemoveTimeoutRef.current);
      toastRemoveTimeoutRef.current = null;
    }

    setToast({ message, isError });
    setToastVisible(false);

    window.requestAnimationFrame(() => {
      setToastVisible(true);
    });

    toastTimeoutRef.current = window.setTimeout(() => {
      setToastVisible(false);
      toastRemoveTimeoutRef.current = window.setTimeout(() => {
        setToast(null);
      }, 180);
    }, 1400);
  }, []);

  const showResultPanel = useCallback(() => {
    setResultPanelHidden(false);
    setResultPanelVisible(false);

    if (resultPanelRafRef.current !== null) {
      window.cancelAnimationFrame(resultPanelRafRef.current);
    }

    resultPanelRafRef.current = window.requestAnimationFrame(() => {
      setResultPanelVisible(true);
    });
  }, []);

  const getAudioContext = useCallback((): AudioContext | null => {
    const AudioCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => undefined);
    }

    return audioContextRef.current;
  }, []);

  const playChime = useCallback(() => {
    if (!soundEnabled) {
      return;
    }

    try {
      const ctx = getAudioContext();
      if (!ctx) {
        return;
      }

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      const startTime = ctx.currentTime + 0.01;

      oscillator.frequency.setValueAtTime(520, startTime);
      oscillator.frequency.exponentialRampToValueAtTime(340, startTime + 0.12);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.22);
    } catch {
      // Ignore browser audio errors.
    }
  }, [getAudioContext, soundEnabled]);

  const preloadImage = useCallback((path: string | undefined) => {
    const resolved = resolveAssetUrl(path);
    if (!resolved || preloadedImageUrlsRef.current.has(resolved)) {
      return;
    }

    preloadedImageUrlsRef.current.add(resolved);
    const img = new Image();
    img.src = resolved;
  }, []);

  const syncUrl = useCallback(
    (resultId: string | null, scoreMap: ScoreMap | null, answerList: number[] | null) => {
      if (!data) {
        return;
      }
      updateUrlState(resultId, scoreMap, answerList, data.dimensions);
    },
    [data]
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const [settings, results, questions] = await Promise.all([
          loadJson<SettingsData>("data/settings.json"),
          loadJson<ResultsData>("data/results.json"),
          loadJson<QuestionsData>("data/questions.json"),
        ]);

        if (cancelled) {
          return;
        }

        const nextData: QuizData = {
          ...settings,
          ...results,
          ...questions,
        };

        setData(nextData);
        setError(null);

        const restored = restoreFromUrl(nextData);
        if (restored) {
          setScores(restored.scores);
          setAnswers(restored.answers);
          setIndex(Math.min(restored.answers.length, Math.max(nextData.questions.length - 1, 0)));
          setFinished(true);
          setLastResult(restored.result);
          setShowDimensions(false);
          showResultPanel();
          return;
        }

        setScores(createInitialScores(nextData.dimensions));
        setAnswers([]);
        setIndex(0);
        setFinished(false);
        setLastResult(null);
        setResultPanelHidden(true);
        setResultPanelVisible(false);
      } catch {
        if (!cancelled) {
          setError("Could not load questions.");
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [showResultPanel]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const nextQuestion = data.questions[index + 1];
    if (!nextQuestion) {
      return;
    }

    preloadImage(nextQuestion.image);
    nextQuestion.options.forEach((option) => preloadImage(option.image));
  }, [data, index, preloadImage]);

  useEffect(() => {
    if (lastResult?.palette) {
      setResultPalette(lastResult.palette);
      setThemePalette(lastResult.palette);
      return;
    }

    resetThemePalette();
  }, [lastResult]);

  useEffect(() => {
    if (!currentQuestion?.image || finished) {
      setQuestionImageStatus("hidden");
      return;
    }
    setQuestionImageStatus("loading");
  }, [currentQuestion?.id, currentQuestion?.image, finished]);

  useEffect(
    () => () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (toastRemoveTimeoutRef.current !== null) {
        window.clearTimeout(toastRemoveTimeoutRef.current);
      }
      if (resultPanelRafRef.current !== null) {
        window.cancelAnimationFrame(resultPanelRafRef.current);
      }
    },
    []
  );

  const finalizeQuiz = useCallback(
    (nextScores: ScoreMap, nextAnswers: number[]) => {
      if (!data) {
        return;
      }

      const resolvedResult = computeResult(data.results, nextScores);
      setFinished(true);
      setLastResult(resolvedResult);
      setShowDimensions(false);
      showResultPanel();
      syncUrl(resolvedResult.id, nextScores, nextAnswers);
    },
    [data, showResultPanel, syncUrl]
  );

  const handleAnswer = useCallback(
    (option: QuestionOption, optionIndex: number) => {
      if (!data || !currentQuestion || answeringLocked || finished) {
        return;
      }

      setAnsweringLocked(true);
      setSelectedOptionIndex(optionIndex);
      playChime();

      const nextScores: ScoreMap = { ...scores };
      Object.entries(option.weights || {}).forEach(([dimId, delta]) => {
        const numericDelta = Number(delta);
        nextScores[dimId] = clamp((nextScores[dimId] || 0) + (Number.isFinite(numericDelta) ? numericDelta : 0), -20, 20);
      });

      const nextAnswers = [...answers];
      nextAnswers[index] = optionIndex;

      setScores(nextScores);
      setAnswers(nextAnswers);

      if (index < data.questions.length - 1) {
        setQuestionTransitioning(true);
        setQuestionBrewing(true);

        if (transitionTimeoutRef.current !== null) {
          window.clearTimeout(transitionTimeoutRef.current);
        }

        transitionTimeoutRef.current = window.setTimeout(() => {
          setIndex((prev) => Math.min(prev + 1, data.questions.length - 1));
          setQuestionTransitioning(false);
          setQuestionBrewing(false);
          setSelectedOptionIndex(null);
          setAnsweringLocked(false);
        }, 350);
        return;
      }

      finalizeQuiz(nextScores, nextAnswers);
    },
    [
      answers,
      answeringLocked,
      currentQuestion,
      data,
      finalizeQuiz,
      finished,
      index,
      playChime,
      scores,
    ]
  );

  useEffect(() => {
    if (!currentQuestion || !data || finished || answeringLocked || !!error) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      let optionIndex = -1;

      if (/^[1-4]$/.test(key)) {
        optionIndex = Number(key) - 1;
      } else if (["a", "b", "c", "d"].includes(key)) {
        optionIndex = key.charCodeAt(0) - 97;
      }

      if (optionIndex < 0 || optionIndex >= currentQuestion.options.length) {
        return;
      }

      event.preventDefault();
      handleAnswer(currentQuestion.options[optionIndex], optionIndex);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [answeringLocked, currentQuestion, data, error, finished, handleAnswer]);

  const handleReset = useCallback(() => {
    if (!data) {
      return;
    }

    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    setIndex(0);
    setFinished(false);
    setAnsweringLocked(false);
    setQuestionTransitioning(false);
    setQuestionBrewing(false);
    setSelectedOptionIndex(null);
    setAnswers([]);
    setScores(createInitialScores(data.dimensions));
    setLastResult(null);
    setShowDimensions(false);
    setResultPanelHidden(true);
    setResultPanelVisible(false);
    setQuestionImageStatus("hidden");
    syncUrl(null, null, null);
  }, [data, syncUrl]);

  const handleCopyResultLink = useCallback(async () => {
    if (!data || !lastResult?.id) {
      return;
    }

    const shareUrl = buildResultShareUrl(lastResult.id, scores, answers, data.dimensions);
    const copied = await copyTextToClipboard(shareUrl);
    showToast(copied ? "Link copied" : "Copy failed", !copied);
  }, [answers, data, lastResult?.id, scores, showToast]);

  const handleDownloadShareCard = useCallback(() => {
    if (!lastResult) {
      return;
    }

    const result = lastResult;
    const canvas = document.createElement("canvas");
    const width = 1080;
    const height = 1240;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

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
    wrapText(ctx, toText(result.title) || "Your Potion", cardX + 60, cardY + 200, cardW - 120, 72);

    const imageWidth = 330;
    const imageHeight = 620;
    const imageX = cardX + cardW - imageWidth - 70;
    const imageY = cardY + 260;

    ctx.fillStyle = "#2a211d";
    ctx.font = "26px Mulish, sans-serif";
    const summaryStartY = cardY + 300;
    const summaryHeight = wrapText(
      ctx,
      toText(result.summary),
      cardX + 60,
      summaryStartY,
      cardW - imageWidth - 150,
      38
    );

    ctx.fillStyle = "#5a4c45";
    ctx.font = "22px Mulish, sans-serif";
    const loreStartY = summaryStartY + summaryHeight + 64;
    wrapText(ctx, toText(result.lore), cardX + 60, loreStartY, cardW - imageWidth - 150, 34);

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

    const triggerDownload = () => {
      const link = document.createElement("a");
      link.download = "potion-result.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };

    if (result.image) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 10;

        const ratio = Math.min(imageWidth / img.width, imageHeight / img.height);
        const drawW = img.width * ratio;
        const drawH = img.height * ratio;
        const drawX = imageX + (imageWidth - drawW) / 2;
        const drawY = imageY + (imageHeight - drawH) / 2;

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        ctx.restore();
        triggerDownload();
      };
      img.onerror = () => {
        triggerDownload();
      };
      img.src = resolveAssetUrl(result.image);
      return;
    }

    triggerDownload();
  }, [lastResult]);

  const questionImageSrc = currentQuestion?.image ? resolveAssetUrl(currentQuestion.image) : "";

  return (
    <>
      <div className="scene-decor scene-decor--left" aria-hidden="true" />
      <div className="scene-decor scene-decor--right" aria-hidden="true" />
      <main className="app">
        <header className="hero">
          <div>
            <div className="hero__eyebrow">Arcane Personality Elixir</div>
            <h1 id="title">{data?.title || "If You Were a Potion"}</h1>
            <p id="subtitle" className="tagline">
              {data?.subtitle || ""}
            </p>
          </div>
          <div className="hero__panel">
            <div className="hero__panel-sigil" aria-hidden="true" />
            <div className="hero__panel-title">Your Profile</div>
            <div className="hero__panel-body" id="liveProfile">
              {liveProfile}
            </div>
          </div>
        </header>

        <section className="progress">
          <div className="progress__bar">
            <div id="progressFill" className="progress__fill" style={progressFillStyle} />
          </div>
          <div className="progress__meta">
            <div className="progress__meta-left">
              <span id="progressLabel" className="progress__count">
                {answeredCount} / {totalQuestions}
              </span>
              <span className="progress__hint">{progressHint}</span>
            </div>
            <div className="progress__actions">
              <button
                id="soundToggleBtn"
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  if (next) {
                    getAudioContext();
                    playChime();
                  }
                }}
              >
                Sound: {soundEnabled ? "On" : "Off"}
              </button>
              <button id="resetBtn" className="btn btn--ghost" type="button" onClick={handleReset}>
                Restart
              </button>
            </div>
          </div>
        </section>

        <section
          className={`question${resultPanelHidden ? "" : " is-hidden"}${
            questionTransitioning ? " is-transitioning" : ""
          }${questionBrewing ? " is-brewing" : ""}`}
          id="questionCard"
        >
          <div className="question__brew" aria-hidden="true" />
          <div className="question__index" id="questionIndex">
            {data && currentQuestion ? `Question ${index + 1}` : ""}
          </div>
          <img
            id="questionImage"
            className={`question__image${questionImageStatus === "loading" ? " is-loading" : ""}${
              questionImageStatus === "ready" ? " is-ready" : ""
            }`}
            src={questionImageSrc || undefined}
            alt={currentQuestion?.prompt || "Question image"}
            onLoad={() => setQuestionImageStatus("ready")}
            onError={() => setQuestionImageStatus("hidden")}
            style={{ display: questionImageStatus === "hidden" ? "none" : "block" }}
          />
          <h2 className="question__prompt" id="questionPrompt">
            {error || currentQuestion?.prompt || (!data ? "Loading quiz..." : "No question available.")}
          </h2>
          {!finished && !error ? (
            <p className="question__assist">
              Choose the response that feels most like you. Shortcut keys: 1-4 or A-D.
            </p>
          ) : null}
          <div className="question__options" id="questionOptions">
            {currentQuestion?.options.map((option, optionIndex) => (
              <button
                key={`${currentQuestion.id}-${optionIndex}`}
                type="button"
                className={`option${selectedOptionIndex === optionIndex ? " is-selected" : ""}`}
                onClick={() => handleAnswer(option, optionIndex)}
                disabled={answeringLocked || !!error || !data || finished}
                aria-disabled={answeringLocked || !!error || !data || finished ? "true" : "false"}
              >
                <span className="option__media">
                  {option.image ? <img src={resolveAssetUrl(option.image)} alt={option.text || "Option image"} /> : null}
                </span>
                <span className="option__content">
                  <span className="option__index" aria-hidden="true">
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="option__text">{option.text}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section
          className={`result-panel${resultPanelHidden ? " is-hidden" : ""}${
            resultPanelVisible ? " is-visible" : ""
          }`}
          id="resultPanel"
        >
          <div className="panel">
            <div className="panel__header">
              <h3>Your Potion</h3>
            </div>
            <img
              id="resultImage"
              className="result__image"
              src={lastResult?.image ? resolveAssetUrl(lastResult.image) : undefined}
              alt={toText(lastResult?.title) || "Potion image"}
              style={{ display: lastResult?.image ? "block" : "none" }}
            />
            <div id="resultCard" className="result">
              <div className="result__title">{toText(lastResult?.title)}</div>
              <div className="result__summary">{toText(lastResult?.summary)}</div>
              <div className="result__lore">{toText(lastResult?.lore)}</div>
              {toText(lastResult?.extra) ? <div className="result__summary">{toText(lastResult?.extra)}</div> : null}

              {toText(lastResult?.side_effect) || toText(lastResult?.signature_ritual) || resultNoteItems.length ? (
                <div className="result__label">
                  {toText(lastResult?.side_effect) ? (
                    <div className="result__label-row">
                      <span className="result__label-key">Side Effect</span>
                      <span className="result__label-value">{toText(lastResult?.side_effect)}</span>
                    </div>
                  ) : null}

                  {toText(lastResult?.signature_ritual) ? (
                    <div className="result__label-row">
                      <span className="result__label-key">Signature Ritual</span>
                      <span className="result__label-value">{toText(lastResult?.signature_ritual)}</span>
                    </div>
                  ) : null}

                  {resultNoteItems.length ? (
                    <div className="result__label-row">
                      <span className="result__label-key">Tasting Notes</span>
                      <div className="result__label-notes">
                        {resultNoteItems.map((item) => (
                          <span key={item.key} className="result__note">
                            {item.key}: {item.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <ul className="result__signals">
                {(Array.isArray(lastResult?.signals) ? lastResult?.signals : []).map((signal, signalIndex) => (
                  <li key={`${signalIndex}-${signal}`}>{signal}</li>
                ))}
              </ul>
            </div>
            <div className="result__dimensions">
              <div className="result__dimensions-header">
                <div className="result__dimensions-title">Your Dimensions</div>
                <button
                  id="toggleDimensionsBtn"
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setShowDimensions((prev) => !prev)}
                >
                  {showDimensions ? "Hide Analysis" : "Show Analysis"}
                </button>
              </div>
              <div id="dimensionPanel" className={`result__dimensions-panel${showDimensions ? "" : " is-hidden"}`}>
                <div id="dimensionList" className="dimension-list">
                  {(data?.dimensions || []).map((dim) => {
                    const raw = clamp(scores[dim.id] || 0, -24, 24);
                    const pct = ((raw + 24) / 48) * 100;

                    return (
                      <div key={dim.id} className="dimension">
                        <div className="dimension__label">
                          <span>{dim.left}</span>
                          <span>{dim.label}</span>
                          <span>{dim.right}</span>
                        </div>
                        <div className="dimension__track">
                          <div className="dimension__fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div id="dimensionLegend" className="dimension-legend">
                  {(data?.dimensions || [])
                    .filter((dim) => toText(dim.description))
                    .map((dim) => (
                      <div key={`${dim.id}-legend`} className="dimension-legend__item">
                        <span className="dimension-legend__name">{dim.label}</span>
                        <span className="dimension-legend__desc">{toText(dim.description)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <div className="result__actions">
              <button id="shareBtn" className="btn" type="button" onClick={handleDownloadShareCard}>
                Download Share Card
              </button>
              <button
                id="shareLinkBtn"
                className="btn btn--ghost"
                type="button"
                onClick={() => void handleCopyResultLink()}
              >
                Copy Result Link
              </button>
              <button id="restartBtn" className="btn btn--ghost" type="button" onClick={handleReset}>
                Take Again
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">Built for reflective decision-making.</footer>

      {toast ? (
        <div className={`toast${toast.isError ? " is-error" : ""}${toastVisible ? " is-visible" : ""}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </>
  );
}

export default App;
