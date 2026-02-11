export interface Dimension {
  id: string;
  label: string;
  left: string;
  right: string;
  description?: string;
}

export interface QuestionOption {
  text: string;
  image?: string;
  weights: Record<string, number>;
}

export interface Question {
  id: string;
  prompt: string;
  image?: string;
  options: QuestionOption[];
}

export interface ResultPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
}

export interface TastingNotes {
  top?: string;
  mid?: string;
  base?: string;
}

export interface ResultCondition {
  type?: string;
  dim?: string;
  op?: "gt" | "lt" | "lte" | "eq" | "gte";
  value?: number;
  min?: number;
  max?: number;
  a?: string;
  b?: string;
  rank?: number;
  dims?: string[];
}

export interface ResultProfile {
  id: string;
  title: string;
  summary: string;
  lore?: string;
  image?: string;
  palette?: ResultPalette;
  tasting_notes?: TastingNotes;
  side_effect?: string;
  signature_ritual?: string;
  signals?: string[];
  priority?: number;
  conditions?: ResultCondition[];
  extra?: string;
  [key: string]: unknown;
}

export interface SettingsData {
  title: string;
  subtitle: string;
  dimensions: Dimension[];
}

export interface QuestionsData {
  questions: Question[];
}

export interface ResultsData {
  results: ResultProfile[];
}

export interface QuizData {
  title: string;
  subtitle: string;
  dimensions: Dimension[];
  questions: Question[];
  results: ResultProfile[];
}

export type ScoreMap = Record<string, number>;

export interface SharedStateV1 {
  v: 1;
  resultId: string;
  scores: ScoreMap;
  answers: number[];
}
