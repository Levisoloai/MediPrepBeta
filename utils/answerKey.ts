import { Question } from '../types';

const stripOptionPrefix = (text: string) => {
  let cleaned = String(text ?? '').trim();
  cleaned = cleaned.replace(/^[A-E]\s*[\)\.\:]\s*/i, '');
  cleaned = cleaned.replace(/^[A-E]\s*-\s*/i, '');
  return cleaned.trim();
};

const normalizeOptionText = (text: string) => stripOptionPrefix(text).toLowerCase();

const parseChoiceAnalysis = (explanation?: string) => {
  if (!explanation) return null;
  const markerMatch = explanation.match(/\*\*(?:Answer\s+)?Choice Analysis:\*\*/i);
  if (!markerMatch || markerMatch.index === undefined) return null;
  const after = explanation.slice(markerMatch.index + markerMatch[0].length);
  const lines = after.split('\n').map((line) => line.trim());
  const tableLines = lines.filter((line) => line.startsWith('|'));
  if (tableLines.length < 3) return null;
  return tableLines.slice(2);
};

const extractCorrectFromExplanation = (explanation: string, options: string[]) => {
  const dataLines = parseChoiceAnalysis(explanation);
  if (!dataLines) return null;
  const normalizedOptions = options.map((opt) => stripOptionPrefix(opt)).filter(Boolean);
  for (const line of dataLines) {
    const cols = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length < 2) continue;
    const optionText = cols[0];
    const rationale = cols[1] || '';
    if (!/^correct\b/i.test(rationale)) continue;
    const normalizedOption = normalizeOptionText(optionText);
    const matched = normalizedOptions.find((opt) => opt.toLowerCase() === normalizedOption)
      || normalizedOptions.find((opt) => opt.toLowerCase().includes(normalizedOption) || normalizedOption.includes(opt.toLowerCase()));
    if (matched) return matched;
  }
  return null;
};

export const resolveCorrectAnswer = (input: {
  correctAnswer: string;
  options: string[];
  explanation?: string;
}) => {
  const { correctAnswer, options, explanation } = input;
  if (options.length === 0) return String(correctAnswer ?? '').trim();

  const answer = String(correctAnswer ?? '').trim();
  const normalizedOptions = options.map((opt) => stripOptionPrefix(opt)).filter(Boolean);
  if (answer) {
    const letterMatch = answer.match(/\b([A-E])\b/i);
    if (letterMatch) {
      const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
      if (normalizedOptions[idx]) return normalizedOptions[idx];
    }
    const normalizedAnswer = stripOptionPrefix(answer).toLowerCase();
    const exact = normalizedOptions.find((opt) => opt.toLowerCase() === normalizedAnswer);
    if (exact) return exact;
    const partial = normalizedOptions.find((opt) => opt.toLowerCase().includes(normalizedAnswer) || normalizedAnswer.includes(opt.toLowerCase()));
    if (partial) return partial;
  }
  if (explanation) {
    const inferred = extractCorrectFromExplanation(explanation, options);
    if (inferred) return inferred;
  }
  return answer ? stripOptionPrefix(answer) : '';
};

export const normalizeOptions = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((opt) => stripOptionPrefix(opt))
      .filter((opt) => opt.length > 0);
  }
  if (raw && typeof raw === 'object') {
    const orderedLetterKeys = ['A', 'B', 'C', 'D', 'E', 'a', 'b', 'c', 'd', 'e'];
    const letterValues = orderedLetterKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(raw, key))
      .map((key) => stripOptionPrefix(raw[key]))
      .filter((opt) => opt.length > 0);
    if (letterValues.length > 0) {
      return letterValues;
    }
    const numericKeys = Object.keys(raw)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      return numericKeys
        .map((key) => stripOptionPrefix(raw[key]))
        .filter((opt) => opt.length > 0);
    }
    return Object.values(raw)
      .map((opt) => stripOptionPrefix(opt))
      .filter((opt) => opt.length > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((opt) => stripOptionPrefix(opt))
      .filter((opt) => opt.length > 0);
  }
  return [];
};

export const normalizeQuestionWithAnswer = (question: Question) => {
  const options = normalizeOptions(question.options);
  return {
    ...question,
    options,
    correctAnswer: resolveCorrectAnswer({
      correctAnswer: question.correctAnswer,
      options,
      explanation: question.explanation
    })
  };
};
