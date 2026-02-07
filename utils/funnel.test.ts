import { describe, it, expect } from 'vitest';
import { QuestionType } from '../types';
import {
  applyAnkiRating,
  computePriority,
  defaultFunnelState,
  ensureConceptState,
  scoreQuestionForConcept,
  selectTargets
} from './funnel';

describe('funnel', () => {
  it('computes higher priority for weaker mastery', () => {
    const strong = { alpha: 12, beta: 2, attempts: 10, lastSeenAtMs: null, avgTimeToAnswerMs: null, tutorTouches: 0 };
    const weak = { alpha: 2, beta: 12, attempts: 10, lastSeenAtMs: null, avgTimeToAnswerMs: null, tutorTouches: 0 };
    expect(computePriority(weak)).toBeGreaterThan(computePriority(strong));
  });

  it('selectTargets enforces min exploration and diversity', () => {
    const funnel = defaultFunnelState();
    const guideConcepts = new Map<string, string>();
    ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].forEach((k) => guideConcepts.set(k, k));

    const targets = selectTargets({ guideConcepts, funnel, total: 10, exploreRatio: 0.2 });
    expect(targets.exploreTargets.length).toBeGreaterThanOrEqual(2);
    expect(targets.targetsPerQuestion.length).toBe(10);
    expect(new Set(targets.focusTargetsDistinct).size).toBeGreaterThanOrEqual(Math.min(4, targets.focusCount));
  });

  it('scores concept match above stem token overlap', () => {
    const q = {
      id: 'q1',
      type: QuestionType.MULTIPLE_CHOICE,
      questionText: 'This stem mentions hemostasis once.',
      options: ['A', 'B'],
      correctAnswer: 'A',
      explanation: '',
      studyConcepts: ['Normal Hemostasis'],
      difficulty: 'Easy'
    };

    const withConcept = scoreQuestionForConcept(q as any, 'Normal Hemostasis');
    const withStemOnly = scoreQuestionForConcept({ ...(q as any), studyConcepts: [] }, 'hemostasis');
    expect(withConcept).toBeGreaterThan(withStemOnly);
  });

  it('applyAnkiRating increases expected for correct easy and decreases for wrong again', () => {
    const funnel = defaultFunnelState();
    const q = {
      id: 'q2',
      type: QuestionType.MULTIPLE_CHOICE,
      questionText: 'Test',
      options: ['A', 'B'],
      correctAnswer: 'A',
      explanation: '',
      studyConcepts: ['Normal Hemostasis'],
      difficulty: 'Easy'
    };

    const key = 'normal hemostasis';
    ensureConceptState(funnel, key, 'Normal Hemostasis');
    const before = computePriority(funnel.concepts[key]);

    applyAnkiRating({
      funnel,
      question: q as any,
      isCorrect: true,
      ankiRating: 4,
      timeToAnswerMs: 30_000,
      tutorUsedBeforeAnswer: false,
      nowMs: Date.now()
    });
    const afterCorrect = computePriority(funnel.concepts[key]);
    expect(afterCorrect).toBeLessThan(before);

    applyAnkiRating({
      funnel,
      question: q as any,
      isCorrect: false,
      ankiRating: 1,
      timeToAnswerMs: 130_000,
      tutorUsedBeforeAnswer: true,
      nowMs: Date.now()
    });
    const afterWrong = computePriority(funnel.concepts[key]);
    expect(afterWrong).toBeGreaterThan(afterCorrect);
  });
});

