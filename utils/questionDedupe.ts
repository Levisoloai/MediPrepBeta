import { Question } from '../types';

const HISTOLOGY_SENTENCES = [
  /A representative histology image is provided below\.?/gi,
  /A representative image is provided below\.?/gi
];

const normalizeLegacy = (value: string) =>
  HISTOLOGY_SENTENCES.reduce((acc, regex) => acc.replace(regex, ''), value || '')
    .trim()
    .replace(/\s+/g, ' ');

export const stripOptionLabel = (value: string) =>
  String(value ?? '').replace(/^[A-E][\).:\-\s]+/i, '').trim();

export const normalizeAggressive = (value: string) =>
  HISTOLOGY_SENTENCES.reduce((acc, regex) => acc.replace(regex, ''), value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildLegacyFingerprint = (question: Question) => {
  const stem = normalizeLegacy(question.questionText || '');
  const options = (question.options || []).map((option) => normalizeLegacy(option)).join('|');
  return `${stem}||${options}`;
};

export const buildAggressiveFingerprint = (question: Question) => {
  const stem = normalizeAggressive(question.questionText || '');
  const options = (question.options || [])
    .map((option) => normalizeAggressive(stripOptionLabel(option)))
    .filter((option) => option.length > 0)
    .sort()
    .join('|');
  return `${stem}||${options}`;
};

export const buildQuestionFingerprint = (question: Question) => buildLegacyFingerprint(question);

export const buildFingerprintVariants = (question: Question) => {
  const variants = [buildLegacyFingerprint(question), buildAggressiveFingerprint(question)]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(variants));
};

export const buildFingerprintSet = (questions: Question[]) => {
  const set = new Set<string>();
  (questions || []).forEach((question) => {
    buildFingerprintVariants(question).forEach((variant) => set.add(variant));
  });
  return set;
};

export const filterDuplicateQuestions = (questions: Question[], existing?: Set<string>) => {
  const fingerprints = existing ? new Set(existing) : new Set<string>();
  const unique: Question[] = [];
  (questions || []).forEach((question) => {
    const variants = buildFingerprintVariants(question);
    if (variants.some((variant) => fingerprints.has(variant))) return;
    variants.forEach((variant) => fingerprints.add(variant));
    unique.push(question);
  });
  return { unique, fingerprints };
};
