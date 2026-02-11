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

type AmbientTrackState = {
  masterGain: GainNode;
  oscillators: OscillatorNode[];
  sources: AudioBufferSourceNode[];
  nodes: AudioNode[];
  lfo: OscillatorNode | null;
  bubbleIntervalId: number | null;
};

function createNoiseBuffer(ctx: AudioContext, durationSeconds = 1): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * 0.65;
  }

  return buffer;
}

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
  const [showPotionCodex, setShowPotionCodex] = useState(false);
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
  const sfxGainRef = useRef<GainNode | null>(null);
  const ambientTrackRef = useRef<AmbientTrackState | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
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

  const allPotions = useMemo(() => data?.results || [], [data]);

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

    if (!sfxGainRef.current) {
      const sfxGain = audioContextRef.current.createGain();
      sfxGain.gain.value = 0.84;
      sfxGain.connect(audioContextRef.current.destination);
      sfxGainRef.current = sfxGain;
    }

    return audioContextRef.current;
  }, []);

  const getNoiseBuffer = useCallback((ctx: AudioContext): AudioBuffer => {
    if (!noiseBufferRef.current || noiseBufferRef.current.sampleRate !== ctx.sampleRate) {
      noiseBufferRef.current = createNoiseBuffer(ctx, 1);
    }
    return noiseBufferRef.current;
  }, []);

  const playAmbientBubble = useCallback(
    (ctx: AudioContext, output: AudioNode) => {
      const now = ctx.currentTime;

      const bubbleOsc = ctx.createOscillator();
      const bubbleGain = ctx.createGain();
      bubbleOsc.type = "sine";
      bubbleOsc.frequency.setValueAtTime(200 + Math.random() * 70, now);
      bubbleOsc.frequency.exponentialRampToValueAtTime(105 + Math.random() * 24, now + 0.24);
      bubbleGain.gain.setValueAtTime(0.0001, now);
      bubbleGain.gain.exponentialRampToValueAtTime(0.026, now + 0.05);
      bubbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      bubbleOsc.connect(bubbleGain);
      bubbleGain.connect(output);
      bubbleOsc.start(now);
      bubbleOsc.stop(now + 0.26);

      const fizz = ctx.createBufferSource();
      fizz.buffer = getNoiseBuffer(ctx);
      const fizzFilter = ctx.createBiquadFilter();
      fizzFilter.type = "bandpass";
      fizzFilter.frequency.value = 820 + Math.random() * 220;
      fizzFilter.Q.value = 0.7;
      const fizzGain = ctx.createGain();
      fizzGain.gain.setValueAtTime(0.0001, now);
      fizzGain.gain.exponentialRampToValueAtTime(0.012, now + 0.04);
      fizzGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      fizz.connect(fizzFilter);
      fizzFilter.connect(fizzGain);
      fizzGain.connect(output);
      fizz.start(now);
      fizz.stop(now + 0.22);
    },
    [getNoiseBuffer]
  );

  const playIngredientDrop = useCallback(() => {
    if (!soundEnabled) {
      return;
    }

    try {
      const ctx = getAudioContext();
      if (!ctx || !sfxGainRef.current) {
        return;
      }

      const output = sfxGainRef.current;
      const startTime = ctx.currentTime + 0.008;

      const dropOsc = ctx.createOscillator();
      const dropFilter = ctx.createBiquadFilter();
      const dropGain = ctx.createGain();
      dropOsc.type = "sine";
      dropOsc.frequency.setValueAtTime(760, startTime);
      dropOsc.frequency.exponentialRampToValueAtTime(180, startTime + 0.17);
      dropFilter.type = "lowpass";
      dropFilter.frequency.value = 1900;
      dropFilter.Q.value = 1.3;
      dropGain.gain.setValueAtTime(0.0001, startTime);
      dropGain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.2);
      dropOsc.connect(dropFilter);
      dropFilter.connect(dropGain);
      dropGain.connect(output);
      dropOsc.start(startTime);
      dropOsc.stop(startTime + 0.22);

      const splashSource = ctx.createBufferSource();
      splashSource.buffer = getNoiseBuffer(ctx);
      const splashFilter = ctx.createBiquadFilter();
      splashFilter.type = "bandpass";
      splashFilter.frequency.value = 980;
      splashFilter.Q.value = 0.95;
      const splashGain = ctx.createGain();
      splashGain.gain.setValueAtTime(0.0001, startTime + 0.01);
      splashGain.gain.exponentialRampToValueAtTime(0.115, startTime + 0.04);
      splashGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.24);
      splashSource.connect(splashFilter);
      splashFilter.connect(splashGain);
      splashGain.connect(output);
      splashSource.start(startTime);
      splashSource.stop(startTime + 0.26);

      const ringOsc = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ringOsc.type = "triangle";
      ringOsc.frequency.setValueAtTime(310, startTime + 0.03);
      ringOsc.frequency.exponentialRampToValueAtTime(138, startTime + 0.34);
      ringGain.gain.setValueAtTime(0.0001, startTime + 0.03);
      ringGain.gain.exponentialRampToValueAtTime(0.075, startTime + 0.06);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.36);
      ringOsc.connect(ringGain);
      ringGain.connect(output);
      ringOsc.start(startTime + 0.03);
      ringOsc.stop(startTime + 0.38);

      playAmbientBubble(ctx, output);
    } catch {
      // Ignore browser audio errors.
    }
  }, [getAudioContext, getNoiseBuffer, playAmbientBubble, soundEnabled]);

  const startAmbientTrack = useCallback(
    (ctx: AudioContext) => {
      if (ambientTrackRef.current) {
        return;
      }

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      masterGain.gain.exponentialRampToValueAtTime(0.058, ctx.currentTime + 1.3);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 760;
      lowpass.Q.value = 0.7;
      lowpass.connect(masterGain);
      masterGain.connect(ctx.destination);

      const oscillators: OscillatorNode[] = [];
      const sources: AudioBufferSourceNode[] = [];
      const nodes: AudioNode[] = [masterGain, lowpass];

      const droneVoices = [
        { type: "sine" as OscillatorType, freq: 82.41, gain: 0.022 },
        { type: "triangle" as OscillatorType, freq: 123.47, gain: 0.014 },
        { type: "sine" as OscillatorType, freq: 164.81, gain: 0.01 },
      ];

      droneVoices.forEach((voice) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = voice.type;
        oscillator.frequency.value = voice.freq;
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = voice.gain;
        oscillator.connect(voiceGain);
        voiceGain.connect(lowpass);
        oscillator.start();
        oscillators.push(oscillator);
        nodes.push(voiceGain);
      });

      const ambienceSource = ctx.createBufferSource();
      ambienceSource.buffer = getNoiseBuffer(ctx);
      ambienceSource.loop = true;
      const ambienceFilter = ctx.createBiquadFilter();
      ambienceFilter.type = "bandpass";
      ambienceFilter.frequency.value = 420;
      ambienceFilter.Q.value = 0.45;
      const ambienceGain = ctx.createGain();
      ambienceGain.gain.value = 0.008;
      ambienceSource.connect(ambienceFilter);
      ambienceFilter.connect(ambienceGain);
      ambienceGain.connect(lowpass);
      ambienceSource.start();
      sources.push(ambienceSource);
      nodes.push(ambienceFilter, ambienceGain);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.045;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain);
      lfoGain.connect(lowpass.frequency);
      lfo.start();
      nodes.push(lfoGain);

      const bubbleIntervalId = window.setInterval(() => {
        if (!ambientTrackRef.current) {
          return;
        }
        playAmbientBubble(ctx, lowpass);
      }, 3200);

      ambientTrackRef.current = {
        masterGain,
        oscillators,
        sources,
        nodes,
        lfo,
        bubbleIntervalId,
      };
    },
    [getNoiseBuffer, playAmbientBubble]
  );

  const stopAmbientTrack = useCallback(() => {
    const track = ambientTrackRef.current;
    const ctx = audioContextRef.current;
    if (!track || !ctx) {
      ambientTrackRef.current = null;
      return;
    }

    if (track.bubbleIntervalId !== null) {
      window.clearInterval(track.bubbleIntervalId);
    }

    const stopTime = ctx.currentTime + 0.45;
    track.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    track.masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);

    track.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop(stopTime);
      } catch {
        // no-op
      }
    });
    track.sources.forEach((source) => {
      try {
        source.stop(stopTime);
      } catch {
        // no-op
      }
    });
    if (track.lfo) {
      try {
        track.lfo.stop(stopTime);
      } catch {
        // no-op
      }
    }

    const nodesToDisconnect = [...track.nodes];
    window.setTimeout(() => {
      nodesToDisconnect.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // no-op
        }
      });
    }, 800);

    ambientTrackRef.current = null;
  }, []);

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

  const buildPotionOnlyUrl = useCallback((resultId: string): string => {
    const url = new URL(window.location.href);
    url.searchParams.set("result", resultId);
    url.searchParams.delete("state");
    url.searchParams.delete("scores");
    return url.toString();
  }, []);

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
      stopAmbientTrack();
      if (sfxGainRef.current) {
        try {
          sfxGainRef.current.disconnect();
        } catch {
          // no-op
        }
        sfxGainRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    },
    [stopAmbientTrack]
  );

  useEffect(() => {
    if (!soundEnabled) {
      stopAmbientTrack();
      return;
    }

    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

    startAmbientTrack(ctx);
  }, [getAudioContext, soundEnabled, startAmbientTrack, stopAmbientTrack]);

  useEffect(() => {
    if (!showPotionCodex) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowPotionCodex(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showPotionCodex]);

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
      playIngredientDrop();

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
      playIngredientDrop,
      scores,
    ]
  );

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

  const handleCopyPotionLink = useCallback(
    async (resultId: string) => {
      const copied = await copyTextToClipboard(buildPotionOnlyUrl(resultId));
      showToast(copied ? "Potion link copied" : "Copy failed", !copied);
    },
    [buildPotionOnlyUrl, showToast]
  );

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
                    playIngredientDrop();
                  }
                }}
              >
                Soundscape: {soundEnabled ? "On" : "Off"}
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
          <div className="question__cauldron-rim" aria-hidden="true" />
          <div className="question__steam" aria-hidden="true" />
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
          <div className="question__options" id="questionOptions">
            {currentQuestion?.options.map((option, optionIndex) => {
              const optionIconSrc = option.image
                ? resolveAssetUrl(option.image)
                : resolveAssetUrl(ingredientIcons[(index + optionIndex) % ingredientIcons.length]);

              return (
                <button
                  key={`${currentQuestion.id}-${optionIndex}`}
                  type="button"
                  className={`option${selectedOptionIndex === optionIndex ? " is-selected" : ""}`}
                  onClick={() => handleAnswer(option, optionIndex)}
                  disabled={answeringLocked || !!error || !data || finished}
                  aria-disabled={answeringLocked || !!error || !data || finished ? "true" : "false"}
                >
                  <span className="option__media">
                    <img src={optionIconSrc} alt="" aria-hidden="true" />
                  </span>
                  <span className="option__content">
                    <span className="option__text">{option.text}</span>
                  </span>
                </button>
              );
            })}
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
              <button className="btn btn--ghost" type="button" onClick={() => setShowPotionCodex(true)}>
                View All Potions
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

      {showPotionCodex ? (
        <div
          className="codex-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowPotionCodex(false);
            }
          }}
        >
          <section className="codex" role="dialog" aria-modal="true" aria-labelledby="codexTitle">
            <div className="codex__header">
              <div>
                <div className="codex__eyebrow">Potion Codex</div>
                <h2 id="codexTitle" className="codex__title">
                  All Potions ({allPotions.length})
                </h2>
              </div>
              <button className="btn btn--ghost" type="button" onClick={() => setShowPotionCodex(false)}>
                Close
              </button>
            </div>

            <div className="codex__grid">
              {allPotions.map((result) => {
                const codexStyle = {
                  "--codex-primary": result.palette?.primary || "#9a4b32",
                  "--codex-secondary": result.palette?.secondary || "#efc08f",
                  "--codex-accent": result.palette?.accent || "#5b2b22",
                } as CSSProperties;

                return (
                  <article key={result.id} className="codex-card" style={codexStyle}>
                    <div className="codex-card__swatch" aria-hidden="true" />
                    {result.image ? (
                      <img
                        className="codex-card__image"
                        src={resolveAssetUrl(result.image)}
                        alt={toText(result.title) || "Potion image"}
                      />
                    ) : null}
                    <div className="codex-card__content">
                      <div className="codex-card__id">{result.id}</div>
                      <h3 className="codex-card__title">{toText(result.title)}</h3>
                      <p className="codex-card__summary">{toText(result.summary)}</p>
                      {toText(result.side_effect) ? (
                        <p className="codex-card__meta">
                          <strong>Side effect:</strong> {toText(result.side_effect)}
                        </p>
                      ) : null}
                    </div>
                    <div className="codex-card__actions">
                      <button
                        className="btn btn--ghost btn--small"
                        type="button"
                        onClick={() => void handleCopyPotionLink(result.id)}
                      >
                        Copy Potion Link
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export default App;
