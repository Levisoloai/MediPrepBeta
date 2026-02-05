import { Question, QuestionType } from '../types';
import { normalizeOptions as normalizeOptionsImpl } from './answerKey';

export const normalizeOptions = (raw: unknown): string[] => normalizeOptionsImpl(raw as any);

const stripOptionPrefix = (text: string) => {
  let cleaned = String(text ?? '').trim();
  cleaned = cleaned.replace(/^[A-E]\s*[\)\.\:]\s*/i, '');
  cleaned = cleaned.replace(/^[A-E]\s*-\s*/i, '');
  return cleaned.trim();
};

export const normalizeOptionText = (text: string): string => stripOptionPrefix(text).toLowerCase();

export type ChoiceAnalysisRow = { optionText: string; rationale: string };

export const parseChoiceAnalysis = (explanation: string): ChoiceAnalysisRow[] => {
  const input = String(explanation ?? '');
  if (!input) return [];
  const markerMatch = input.match(/\*\*(?:Answer\s+)?Choice Analysis:\*\*/i);
  if (!markerMatch || markerMatch.index === undefined) return [];

  const after = input.slice(markerMatch.index + markerMatch[0].length);
  const lines = after.split('\n').map((line) => line.trim());
  const tableLines = lines.filter((line) => line.startsWith('|'));
  if (tableLines.length < 3) return [];

  const dataLines = tableLines.slice(2);
  const rows: ChoiceAnalysisRow[] = [];
  for (const line of dataLines) {
    const cols = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cols.length < 2) continue;
    rows.push({ optionText: cols[0], rationale: cols[1] || '' });
  }
  return rows;
};

const matchOptionFromText = (needle: string, options: string[]): string | null => {
  const raw = String(needle ?? '').trim();
  if (!raw) return null;

  const letterOnly = raw.match(/^([A-E])$/i);
  if (letterOnly) {
    const idx = letterOnly[1].toUpperCase().charCodeAt(0) - 65;
    return options[idx] ? options[idx] : null;
  }

  const normalizedNeedle = normalizeOptionText(raw);
  if (!normalizedNeedle) return null;

  const exactMatches = options.filter((opt) => normalizeOptionText(opt) === normalizedNeedle);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const fuzzyMatches = options.filter((opt) => {
    const normOpt = normalizeOptionText(opt);
    return normOpt.includes(normalizedNeedle) || normalizedNeedle.includes(normOpt);
  });
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  return null;
};

export const inferCorrectFromChoiceAnalysis = (explanation: string, options: string[]): string | null => {
  const rows = parseChoiceAnalysis(explanation);
  if (!rows.length) return null;
  const correctRows = rows.filter((row) => /^correct\b/i.test(String(row.rationale ?? '').trim()));
  if (correctRows.length !== 1) return null;
  return matchOptionFromText(correctRows[0].optionText, options);
};

export type CorrectAnswerSource = 'analysis' | 'field' | 'letter' | 'empty' | 'unresolved';

export const resolveCorrectAnswerStrict = (input: {
  correctAnswer: string;
  options: string[];
  explanation?: string;
}): { value: string; source: CorrectAnswerSource } => {
  const options = Array.isArray(input.options) ? input.options : [];
  const explanation = String(input.explanation ?? '');

  if (options.length > 0 && explanation) {
    const inferred = inferCorrectFromChoiceAnalysis(explanation, options);
    if (inferred) return { value: inferred, source: 'analysis' };
  }

  const rawAnswer = String(input.correctAnswer ?? '').trim();
  if (!rawAnswer) return { value: '', source: 'empty' };

  const letterMatch = rawAnswer.match(/^([A-E])(?:[\)\.\:\s]|$)/i) || rawAnswer.match(/\b([A-E])\b/i);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (options[idx]) return { value: options[idx], source: 'letter' };
  }

  if (options.length > 0) {
    const normalizedAnswer = normalizeOptionText(rawAnswer);
    const exact = options.filter((opt) => normalizeOptionText(opt) === normalizedAnswer);
    if (exact.length === 1) return { value: exact[0], source: 'field' };

    const partial = options.filter((opt) => {
      const normOpt = normalizeOptionText(opt);
      return normOpt.includes(normalizedAnswer) || normalizedAnswer.includes(normOpt);
    });
    if (partial.length === 1) return { value: partial[0], source: 'field' };
  }

  return { value: stripOptionPrefix(rawAnswer), source: 'unresolved' };
};

export const validateAnswerKey = (question: Pick<Question, 'options' | 'correctAnswer' | 'type'>): { ok: boolean; reason?: string } => {
  const options = Array.isArray(question.options) ? question.options : [];
  if (question.type === QuestionType.DESCRIPTIVE) return { ok: true };

  if (options.length < 2) return { ok: false, reason: 'Options missing' };
  const correct = String(question.correctAnswer ?? '').trim();
  if (!correct) return { ok: false, reason: 'Correct answer missing' };

  const normalizedCorrect = normalizeOptionText(correct);
  const matches = options.filter((opt) => normalizeOptionText(opt) === normalizedCorrect);
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? 'Correct answer not found in options' : 'Correct answer ambiguous' };
  }
  return { ok: true };
};

const shuffle = <T,>(items: T[]): T[] => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export type PrepareIntegrity = {
  correctSource: CorrectAnswerSource;
  shuffled: boolean;
};

export const prepareQuestionForSession = (
  question: Question,
  opts: { shuffleOptions: boolean }
): { question: Question; integrity: PrepareIntegrity } | null => {
  const normalizedOptions = normalizeOptions(question.options);
  const resolved = resolveCorrectAnswerStrict({
    correctAnswer: question.correctAnswer,
    options: normalizedOptions,
    explanation: question.explanation
  });

  // Descriptive questions are allowed to have no options.
  if (question.type === QuestionType.DESCRIPTIVE) {
    return {
      question: {
        ...question,
        options: normalizedOptions,
        correctAnswer: resolved.value
      },
      integrity: {
        correctSource: resolved.source,
        shuffled: false
      }
    };
  }

  if (normalizedOptions.length < 2) return null;

  const finalOptions = opts.shuffleOptions ? shuffle(normalizedOptions) : normalizedOptions;
  const normalizedCorrect = normalizeOptionText(resolved.value);
  const snapped = finalOptions.filter((opt) => normalizeOptionText(opt) === normalizedCorrect);
  if (snapped.length !== 1) return null;

  const prepared: Question = {
    ...question,
    options: finalOptions,
    correctAnswer: snapped[0]
  };

  const validation = validateAnswerKey(prepared);
  if (!validation.ok) return null;

  return {
    question: prepared,
    integrity: {
      correctSource: resolved.source,
      shuffled: Boolean(opts.shuffleOptions)
    }
  };
};

export type IntegrityCounters = {
  total_questions_rendered: number;
  repaired_from_choice_analysis: number;
  repaired_from_letter: number;
  dropped_unrepairable: number;
};

const STORAGE_KEY = 'mediprep_integrity_stats_v1';

const emptyCounters = (): IntegrityCounters => ({
  total_questions_rendered: 0,
  repaired_from_choice_analysis: 0,
  repaired_from_letter: 0,
  dropped_unrepairable: 0
});

export const getIntegrityStats = (): Record<string, IntegrityCounters> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, IntegrityCounters>;
  } catch {
    return {};
  }
};

const writeIntegrityStats = (stats: Record<string, IntegrityCounters>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  window.dispatchEvent(new Event('integrity_updated'));
};

export const recordIntegrityRendered = (sourceType: string, integrity: PrepareIntegrity) => {
  if (typeof window === 'undefined') return;
  const key = sourceType || 'other';
  const stats = getIntegrityStats();
  const current = stats[key] || emptyCounters();
  current.total_questions_rendered += 1;
  if (integrity.correctSource === 'analysis') current.repaired_from_choice_analysis += 1;
  if (integrity.correctSource === 'letter') current.repaired_from_letter += 1;
  stats[key] = current;
  writeIntegrityStats(stats);
};

export const recordIntegrityDropped = (sourceType: string) => {
  if (typeof window === 'undefined') return;
  const key = sourceType || 'other';
  const stats = getIntegrityStats();
  const current = stats[key] || emptyCounters();
  current.dropped_unrepairable += 1;
  stats[key] = current;
  writeIntegrityStats(stats);
};

