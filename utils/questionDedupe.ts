import { Question } from '../types';

const normalize = (value: string) =>
  value
    .replace(/A representative histology image is provided below\.?/gi, '')
    .replace(/A representative image is provided below\.?/gi, '')
    .trim()
    .replace(/\s+/g, ' ');

export const buildQuestionFingerprint = (question: Question) => {
  const stem = normalize(question.questionText || '');
  const options = (question.options || []).map((option) => normalize(option)).join('|');
  return `${stem}||${options}`;
};

export const buildFingerprintSet = (questions: Question[]) => {
  const set = new Set<string>();
  (questions || []).forEach((question) => {
    set.add(buildQuestionFingerprint(question));
  });
  return set;
};

export const filterDuplicateQuestions = (questions: Question[], existing?: Set<string>) => {
  const fingerprints = existing ? new Set(existing) : new Set<string>();
  const unique: Question[] = [];
  (questions || []).forEach((question) => {
    const fingerprint = buildQuestionFingerprint(question);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    unique.push(question);
  });
  return { unique, fingerprints };
};
