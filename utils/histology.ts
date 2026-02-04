import { Question, HistologyEntry } from '../types';
import { histologyBank } from './histologyBank';

const HISTOLOGY_TRIGGERS = [
  'histology',
  'histologic',
  'microscopy',
  'microscopic',
  'biopsy',
  'peripheral smear',
  'smear',
  'blood film',
  'bone marrow',
  'marrow',
  'morphology',
  'slide',
  'image is provided below',
  'image provided below',
  'representative image'
];

const HISTOLOGY_BASE_URL = (import.meta.env.VITE_HISTOLOGY_BASE_URL || '').trim();
const TAG_STOPWORDS = new Set(['anemia', 'deficiency', 'disease', 'syndrome', 'disorder']);
const GENERIC_KEYWORDS = new Set(['anemia', 'deficiency', 'disease', 'syndrome', 'disorder', 'cell', 'cells', 'blood', 'smear']);

const resolveHistologyUrl = (imageUrl: string) => {
  if (!imageUrl || !HISTOLOGY_BASE_URL) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const base = HISTOLOGY_BASE_URL.replace(/\/$/, '');
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
};

const normalizeModule = (moduleId?: string | null): HistologyEntry['module'] | null => {
  if (!moduleId) return null;
  const lowered = moduleId.toLowerCase();
  if (lowered.includes('heme') || lowered.includes('hematology')) return 'heme';
  if (lowered.includes('pulm') || lowered.includes('pulmonology')) return 'pulm';
  return null;
};

const tokenize = (text: string) =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const buildCoreText = (question: Question) =>
  [
    question.questionText || '',
    question.studyConcepts?.join(' ') || '',
    question.correctAnswer || ''
  ].join(' ');

const buildCoreRaw = (question: Question) =>
  [
    question.questionText || '',
    question.studyConcepts?.join(' ') || '',
    question.correctAnswer || ''
  ].join(' ');

const hasHistologyCue = (question: Question) => {
  const text = buildCoreText(question).toLowerCase();
  return HISTOLOGY_TRIGGERS.some((trigger) => text.includes(trigger));
};

const matchesNeedle = (
  needle: string,
  searchText: string,
  textTokens: Set<string>,
  searchRaw: string
) => {
  const norm = needle.toLowerCase().trim();
  if (!norm) return false;
  const isAbbrev = needle.trim().length <= 4 && needle.trim() === needle.trim().toUpperCase();
  if (isAbbrev) {
    const abbrevRegex = new RegExp(`\\b${needle.trim()}\\b`);
    return abbrevRegex.test(searchRaw);
  }
  if (norm.includes(' ')) {
    return searchText.includes(norm);
  }
  return textTokens.has(norm);
};

const matchesAny = (
  needles: string[] | undefined,
  searchText: string,
  textTokens: Set<string>,
  searchRaw: string
) => {
  if (!needles || needles.length === 0) return false;
  return needles.some((needle) => matchesNeedle(needle, searchText, textTokens, searchRaw));
};

const matchesTag = (
  tag: string,
  searchText: string,
  textTokens: Set<string>,
  searchRaw: string
) => {
  const tagNorm = tag.toLowerCase().trim();
  if (!tagNorm) return false;

  const isAbbrev = tag.trim().length <= 4 && tag.trim() === tag.trim().toUpperCase();
  if (isAbbrev) {
    const abbrevRegex = new RegExp(`\\b${tag.trim()}\\b`);
    return abbrevRegex.test(searchRaw);
  }

  if (tagNorm.length <= 3) {
    return textTokens.has(tagNorm);
  }

  if (searchText.includes(tagNorm)) {
    return true;
  }

  const tagTokens = tokenize(tagNorm);
  const filteredTokens = tagTokens.filter((token) => !TAG_STOPWORDS.has(token));
  const tokensToMatch = filteredTokens.length > 0 ? filteredTokens : tagTokens;

  if (tokensToMatch.length === 0) return false;
  if (tokensToMatch.length === 1) return textTokens.has(tokensToMatch[0]);
  return tokensToMatch.every((token) => textTokens.has(token));
};

const findBestEntry = (
  question: Question,
  pool: HistologyEntry[],
  usage: Map<string, number>
) => {
  const coreRaw = buildCoreRaw(question);
  const coreText = coreRaw.toLowerCase();
  const textTokens = new Set(tokenize(coreText));
  let best: HistologyEntry | null = null;
  let bestScore = 0;

  pool.forEach((entry) => {
    if (entry.excludeAny && matchesAny(entry.excludeAny, coreText, textTokens, coreRaw)) {
      return;
    }
    if (entry.requiredAny && !matchesAny(entry.requiredAny, coreText, textTokens, coreRaw)) {
      return;
    }

    const keywordScore = entry.keywords.reduce((acc, keyword) => {
      const normalized = keyword.toLowerCase().trim();
      if (!normalized || GENERIC_KEYWORDS.has(normalized)) return acc;
      if (normalized.includes(' ')) {
        return acc + (coreText.includes(normalized) ? 1 : 0);
      }
      return acc + (textTokens.has(normalized) ? 1 : 0);
    }, 0);
    let tagScore = 0;
    let tagMatch = false;
    const tags = entry.conceptTags || [];
    tags.forEach((tag) => {
      if (!matchesTag(tag, coreText, textTokens, coreRaw)) return;
      tagScore += 4;
      tagMatch = true;
    });

    if (tags.length > 0 && !tagMatch) return;
    const score = keywordScore + tagScore;
    if (score <= 0) return;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
      return;
    }
    if (score === bestScore && best) {
      const usageCount = usage.get(entry.id) || 0;
      const bestUsage = usage.get(best.id) || 0;
      if (usageCount < bestUsage) {
        best = entry;
      } else if (usageCount === bestUsage && Math.random() < 0.35) {
        best = entry;
      }
    }
  });

  if (!best) return null;
  const minScore = best.keywords.length >= 6 ? 2 : 1;
  return bestScore >= minScore ? best : null;
};

const addHistologyCue = (text: string) => {
  const stripped = stripHistologyCue(text);
  const lower = stripped.toLowerCase();
  if (lower.includes('image') || lower.includes('histology') || lower.includes('smear')) {
    return stripped;
  }
  const cue = 'A representative image is provided below.';
  return stripped.trim().length > 0 ? `${stripped.trim()}\n\n${cue}` : cue;
};

const stripHistologyCue = (text: string) => {
  if (!text) return text;
  return text
    .replace(/A representative histology image is provided below\\.?/gi, '')
    .replace(/A representative image is provided below\\.?/gi, '')
    .replace(/A representative histology image is provided\\.*/gi, '')
    .replace(/A representative image is provided\\.*/gi, '')
    .replace(/image is provided below\\.?/gi, '')
    .replace(/histology image is provided below\\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const attachHistologyToQuestions = (
  questions: Question[],
  moduleId?: string | null,
  options?: { maxPerSession?: number; existingQuestions?: Question[] }
) => {
  const module = normalizeModule(moduleId);
  if (!module) return questions;
  const pool = histologyBank.filter((entry) => entry.module === module);
  if (pool.length === 0) return questions;

  const maxPerSession = options?.maxPerSession ?? Math.max(3, Math.round(questions.length * 0.6));
  let attached = 0;
  const usage = new Map<string, number>();

  if (options?.existingQuestions) {
    options.existingQuestions.forEach((q) => {
      if (!q.histology) return;
      usage.set(q.histology.id, (usage.get(q.histology.id) || 0) + 1);
    });
  }

  return questions.map((question) => {
    if (attached >= maxPerSession) return question;
    if (question.histology) return question;

    const cue = hasHistologyCue(question);
    const entry = findBestEntry(question, pool, usage);
    if (!entry) {
      if (cue) {
        return {
          ...question,
          questionText: stripHistologyCue(question.questionText)
        };
      }
      return question;
    }

    attached += 1;
    usage.set(entry.id, (usage.get(entry.id) || 0) + 1);
    return {
      ...question,
      questionText: addHistologyCue(question.questionText),
      histology: {
        id: entry.id,
        title: entry.title,
        imageUrl: resolveHistologyUrl(entry.imageUrl),
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
