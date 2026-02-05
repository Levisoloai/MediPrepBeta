import { HistologyEntry, Question, QuestionType, CardStyle } from '../types';
import { histologyBank } from './histologyBank';

export type HistologyReviewMode = 'diagnosis' | 'vignette';

const HISTOLOGY_BASE_URL = (import.meta.env.VITE_HISTOLOGY_BASE_URL || '').trim();

const shuffle = <T>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const selectHistologyEntries = (module: HistologyEntry['module'], count: number) => {
  const pool = histologyBank.filter((entry) => entry.module === module);
  return shuffle(pool).slice(0, Math.min(count, pool.length));
};

const resolveHistologyUrl = (imageUrl: string) => {
  if (!imageUrl || !HISTOLOGY_BASE_URL) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const base = HISTOLOGY_BASE_URL.replace(/\/$/, '');
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
};

const buildOptions = (entries: HistologyEntry[], correct: HistologyEntry, count = 5) => {
  const distractors = entries.filter((entry) => entry.id !== correct.id);
  const picked = shuffle(distractors).slice(0, Math.max(0, count - 1));
  return shuffle([correct.title, ...picked.map((entry) => entry.title)]);
};

const buildExplanation = (entry: HistologyEntry) => {
  const caption = entry.caption?.trim();
  const clue = caption ? caption : `This image highlights ${entry.title}.`;
  return [
    `**Explanation:** ${clue}`,
    `**Key Clue:** Morphology classic for ${entry.title}.`,
    '**Educational Objective:** Recognize the key histologic pattern and link it to the diagnosis.'
  ].join('\n');
};

export const buildHistologyReviewQuestions = (args: {
  entries: HistologyEntry[];
  vignettes?: Record<string, string>;
  mode: HistologyReviewMode;
}): Question[] => {
  const { entries, vignettes = {}, mode } = args;
  return entries.map((entry) => {
    const vignette = (vignettes[entry.id] || '').trim();
    const questionText =
      mode === 'vignette' && vignette
        ? vignette
        : 'What is this histology most representative of?';
    const options = buildOptions(entries, entry, 5);
    return {
      id: crypto.randomUUID(),
      type: QuestionType.MULTIPLE_CHOICE,
      questionText,
      options,
      correctAnswer: entry.title,
      explanation: buildExplanation(entry),
      studyConcepts: entry.conceptTags?.length ? entry.conceptTags : entry.keywords.slice(0, 3),
      difficulty: 'Clinical vignette',
      cardStyle: CardStyle.BASIC,
      sourceType: 'histology',
      histology: {
        id: entry.id,
        title: entry.title,
        imageUrl: resolveHistologyUrl(entry.imageUrl),
        imageCrop: entry.imageCrop,
        caption: entry.caption,
        source: entry.source,
        sourceUrl: entry.sourceUrl,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        attribution: entry.attribution
      }
    };
  });
};
