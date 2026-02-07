import type { Question, StudyGuideItem } from '../types';

export type FunnelConceptState = {
  alpha: number;
  beta: number;
  attempts: number;
  lastSeenAtMs: number | null;
  avgTimeToAnswerMs: number | null;
  tutorTouches: number;
  display?: string;
};

export type FunnelState = {
  concepts: Record<string, FunnelConceptState>;
};

export type FunnelBatchMeta = {
  guideHash: string;
  guideTitle?: string;
  createdAt: string;
  total: number;
  focusCount: number;
  exploreCount: number;
  focusTargets: string[];
  exploreTargets: string[];
  targetsPerQuestion: string[];
  targetByQuestionId: Record<string, string>;
  sourceCounts: { gold: number; prefab: number; generated: number };
  backfillAttempts: number;
  droppedGenerated: number;
  shortfall: number;
  displayByKey?: Record<string, string>;
};

export const defaultFunnelState = (): FunnelState => ({ concepts: {} });

export const normalizeConceptKey = (value: string) =>
  String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-]/g, '');

const tokenize = (value: string) =>
  normalizeConceptKey(value)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const getExpected = (state: FunnelConceptState) => {
  const a = Math.max(0.0001, Number(state.alpha) || 0);
  const b = Math.max(0.0001, Number(state.beta) || 0);
  return a / (a + b);
};

export const getUncertainty = (state: FunnelConceptState) => {
  const a = Math.max(0.0001, Number(state.alpha) || 0);
  const b = Math.max(0.0001, Number(state.beta) || 0);
  const sum = a + b;
  return Math.sqrt((a * b) / (sum * sum * (sum + 1)));
};

export const computePriority = (state: FunnelConceptState) => {
  const expected = getExpected(state);
  const uncertainty = getUncertainty(state);
  const avgTime = state.avgTimeToAnswerMs ?? 0;
  const tutorTouches = state.tutorTouches ?? 0;

  const wWeak = 1.0;
  const wUnc = 0.4;
  const wTime = 0.3;
  const wTutor = 0.2;

  const timeFactor = clamp((avgTime - 60_000) / 60_000, 0, 1);
  const tutorFactor = clamp(tutorTouches / 3, 0, 1);

  return wWeak * (1 - expected) + wUnc * uncertainty + wTime * timeFactor + wTutor * tutorFactor;
};

export const ensureConceptState = (
  funnel: FunnelState,
  key: string,
  display?: string
): FunnelConceptState => {
  const existing = funnel.concepts[key];
  if (existing) {
    if (!existing.display && display) existing.display = display;
    return existing;
  }
  funnel.concepts[key] = {
    alpha: 1,
    beta: 1,
    attempts: 0,
    lastSeenAtMs: null,
    avgTimeToAnswerMs: null,
    tutorTouches: 0,
    ...(display ? { display } : {})
  };
  return funnel.concepts[key];
};

export const buildGuideConceptUniverse = (
  guideItems: StudyGuideItem[] | undefined,
  funnel: FunnelState
) => {
  const concepts = new Map<string, string>(); // key -> display
  (guideItems || []).forEach((item) => {
    const title = String(item?.title ?? '').trim();
    if (!title) return;
    const key = normalizeConceptKey(title);
    if (!key || key.length < 3) return;
    if (!concepts.has(key)) concepts.set(key, title);
  });

  Object.entries(funnel.concepts || {}).forEach(([key, state]) => {
    if (!key || key.length < 3) return;
    if (!concepts.has(key)) concepts.set(key, state.display || key);
  });

  return concepts;
};

export const selectTargets = (input: {
  guideConcepts: Map<string, string>;
  funnel: FunnelState;
  total: number;
  exploreRatio?: number;
}) => {
  const total = Math.max(1, Math.floor(input.total));
  const exploreCount = Math.max(2, Math.round((input.exploreRatio ?? 0.2) * total));
  const focusCount = Math.max(0, total - exploreCount);

  const keys = Array.from(input.guideConcepts.keys());
  const stats = keys.map((key) => {
    const state = input.funnel.concepts[key] || {
      alpha: 1,
      beta: 1,
      attempts: 0,
      lastSeenAtMs: null,
      avgTimeToAnswerMs: null,
      tutorTouches: 0
    };
    return { key, attempts: state.attempts || 0, priority: computePriority(state) };
  });

  const byPriority = [...stats].sort((a, b) => b.priority - a.priority);
  const byAttemptsAsc = [...stats].sort((a, b) => a.attempts - b.attempts);

  const distinctNeeded = Math.min(4, focusCount);
  const focusTargetsDistinct = byPriority.slice(0, distinctNeeded).map((s) => s.key);
  const poolForRepeats = byPriority.slice(0, Math.min(10, byPriority.length)).map((s) => s.key);

  const focusQueue: string[] = [];
  focusTargetsDistinct.forEach((k) => focusQueue.push(k));
  for (let i = focusQueue.length; i < focusCount; i += 1) {
    if (poolForRepeats.length === 0) break;
    focusQueue.push(poolForRepeats[i % poolForRepeats.length]);
  }

  const exploreTargets = byAttemptsAsc.slice(0, Math.min(exploreCount, byAttemptsAsc.length)).map((s) => s.key);

  // Interleave exploration concepts roughly evenly through the batch.
  const targetsPerQuestion: string[] = [];
  let iFocus = 0;
  let iExplore = 0;
  const stride = exploreTargets.length > 0 ? Math.max(1, Math.floor(total / exploreTargets.length)) : total;
  for (let i = 0; i < total; i += 1) {
    const shouldExplore = iExplore < exploreTargets.length && i % stride === 0;
    if (shouldExplore) {
      targetsPerQuestion.push(exploreTargets[iExplore]);
      iExplore += 1;
      continue;
    }
    if (iFocus < focusQueue.length) {
      targetsPerQuestion.push(focusQueue[iFocus]);
      iFocus += 1;
      continue;
    }
    if (iExplore < exploreTargets.length) {
      targetsPerQuestion.push(exploreTargets[iExplore]);
      iExplore += 1;
      continue;
    }
    if (poolForRepeats.length > 0) {
      targetsPerQuestion.push(poolForRepeats[i % poolForRepeats.length]);
    } else {
      targetsPerQuestion.push('general');
    }
  }

  return {
    focusCount,
    exploreCount,
    focusTargetsDistinct,
    exploreTargets,
    targetsPerQuestion
  };
};

const countConceptMatch = (question: Question, targetKey: string) => {
  const needle = normalizeConceptKey(targetKey);
  if (!needle) return 0;
  const tags = Array.isArray(question.studyConcepts) ? question.studyConcepts : [];
  let hits = 0;
  tags.forEach((tag) => {
    const t = normalizeConceptKey(tag);
    if (!t) return;
    if (t.includes(needle) || needle.includes(t)) hits += 1;
  });
  return hits;
};

export const scoreQuestionForConcept = (question: Question, targetKey: string) => {
  const conceptMatch = countConceptMatch(question, targetKey);
  const targetTokens = new Set(tokenize(targetKey));
  const stemTokens = new Set(tokenize(question.questionText || ''));
  let overlap = 0;
  targetTokens.forEach((t) => {
    if (stemTokens.has(t)) overlap += 1;
  });
  return 3 * conceptMatch + 1 * overlap;
};

export const recordTutorTouch = (funnel: FunnelState, question: Question, nowMs: number) => {
  const rawConcepts = Array.isArray(question.studyConcepts) && question.studyConcepts.length > 0
    ? question.studyConcepts
    : ['General'];
  rawConcepts.forEach((concept) => {
    const display = String(concept ?? '').trim() || 'General';
    const key = normalizeConceptKey(display) || 'general';
    const state = ensureConceptState(funnel, key, display);
    state.tutorTouches = (state.tutorTouches || 0) + 1;
    state.lastSeenAtMs = nowMs;
  });
};

export const applyAnkiRating = (input: {
  funnel: FunnelState;
  question: Question;
  isCorrect: boolean;
  ankiRating: 1 | 2 | 3 | 4;
  timeToAnswerMs: number | null;
  tutorUsedBeforeAnswer: boolean;
  nowMs: number;
}) => {
  const { funnel, question, isCorrect, ankiRating, timeToAnswerMs, tutorUsedBeforeAnswer, nowMs } = input;

  let correctWeight = 0;
  let wrongWeight = 0;

  if (ankiRating === 1) {
    wrongWeight = 1.2;
  } else if (ankiRating === 2) {
    if (isCorrect) {
      correctWeight = 0.6;
      wrongWeight = 0.4;
    } else {
      wrongWeight = 1.0;
    }
  } else if (ankiRating === 3) {
    if (isCorrect) correctWeight = 1.0;
    else wrongWeight = 1.0;
  } else {
    if (isCorrect) correctWeight = 1.3;
    else wrongWeight = 1.0;
  }

  if (typeof timeToAnswerMs === 'number' && timeToAnswerMs > 120_000) {
    wrongWeight += 0.2;
  }
  if (tutorUsedBeforeAnswer) {
    wrongWeight += 0.2;
  }

  const rawConcepts = Array.isArray(question.studyConcepts) && question.studyConcepts.length > 0
    ? question.studyConcepts
    : ['General'];

  const updates: string[] = [];

  rawConcepts.forEach((concept) => {
    const display = String(concept ?? '').trim() || 'General';
    const key = normalizeConceptKey(display) || 'general';
    const state = ensureConceptState(funnel, key, display);

    const prevAttempts = state.attempts || 0;
    state.alpha = (Number(state.alpha) || 1) + correctWeight;
    state.beta = (Number(state.beta) || 1) + wrongWeight;
    state.attempts = prevAttempts + 1;
    state.lastSeenAtMs = nowMs;

    if (typeof timeToAnswerMs === 'number' && Number.isFinite(timeToAnswerMs) && timeToAnswerMs > 0) {
      const prevAvg = state.avgTimeToAnswerMs;
      if (typeof prevAvg !== 'number' || !Number.isFinite(prevAvg)) {
        state.avgTimeToAnswerMs = timeToAnswerMs;
      } else {
        state.avgTimeToAnswerMs = (prevAvg * prevAttempts + timeToAnswerMs) / (prevAttempts + 1);
      }
    }

    updates.push(key);
  });

  return { updatedConceptKeys: Array.from(new Set(updates)) };
};
