import { describe, expect, it } from 'vitest';
import { QuestionType } from '../types';
import {
  inferCorrectFromChoiceAnalysis,
  parseChoiceAnalysis,
  prepareQuestionForSession,
  resolveCorrectAnswerStrict,
  validateAnswerKey
} from './questionIntegrity';

describe('questionIntegrity', () => {
  it('parses Choice Analysis table (Choice Analysis marker)', () => {
    const explanation = [
      '**Explanation:** test',
      '**Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| Argatroban | Correct; best option. |',
      '| Heparin | Incorrect; If it were instead: ... |'
    ].join('\n');
    const rows = parseChoiceAnalysis(explanation);
    expect(rows.length).toBe(2);
    expect(rows[0].optionText).toBe('Argatroban');
    expect(rows[0].rationale.toLowerCase()).toContain('correct');
  });

  it('parses Choice Analysis table (Answer Choice Analysis marker)', () => {
    const explanation = [
      '**Explanation:** test',
      '**Answer Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| A. Foo | Incorrect; ... |',
      '| B. Bar | Correct; ... |'
    ].join('\n');
    const rows = parseChoiceAnalysis(explanation);
    expect(rows.length).toBe(2);
    expect(rows[1].optionText).toBe('B. Bar');
  });

  it('infers correct option from Choice Analysis when uniquely marked', () => {
    const options = ['Argatroban', 'Heparin'];
    const explanation = [
      '**Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| Argatroban | Correct; ... |',
      '| Heparin | Incorrect; ... |'
    ].join('\n');
    expect(inferCorrectFromChoiceAnalysis(explanation, options)).toBe('Argatroban');
  });

  it('does not infer correct option when multiple rows marked correct', () => {
    const options = ['Argatroban', 'Heparin'];
    const explanation = [
      '**Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| Argatroban | Correct; ... |',
      '| Heparin | Correct; ... |'
    ].join('\n');
    expect(inferCorrectFromChoiceAnalysis(explanation, options)).toBeNull();
  });

  it('resolveCorrectAnswerStrict prefers analysis over letter', () => {
    const options = ['Heparin', 'Argatroban', 'Fondaparinux', 'Warfarin', 'LMWH'];
    const explanation = [
      '**Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| Heparin | Incorrect; ... |',
      '| Argatroban | Correct; ... |',
      '| Fondaparinux | Incorrect; ... |',
      '| Warfarin | Incorrect; ... |',
      '| LMWH | Incorrect; ... |'
    ].join('\n');
    const resolved = resolveCorrectAnswerStrict({ correctAnswer: 'B', options, explanation });
    expect(resolved.source).toBe('analysis');
    expect(resolved.value).toBe('Argatroban');
  });

  it('prepareQuestionForSession keeps correct answer stable under shuffle', () => {
    const options = ['Heparin', 'Argatroban', 'Fondaparinux', 'Warfarin', 'LMWH'];
    const explanation = [
      '**Choice Analysis:**',
      '| Option | Rationale |',
      '| --- | --- |',
      '| Heparin | Incorrect; ... |',
      '| Argatroban | Correct; key. |',
      '| Fondaparinux | Incorrect; ... |',
      '| Warfarin | Incorrect; ... |',
      '| LMWH | Incorrect; ... |'
    ].join('\n');

    for (let i = 0; i < 15; i += 1) {
      const prepared = prepareQuestionForSession(
        {
          id: `q-${i}`,
          type: QuestionType.MULTIPLE_CHOICE,
          questionText: 'Test stem',
          options,
          correctAnswer: 'B',
          explanation,
          studyConcepts: ['HIT'],
          difficulty: 'Clinical Vignette (USMLE Style)'
        },
        { shuffleOptions: true }
      );
      expect(prepared).not.toBeNull();
      if (!prepared) continue;
      expect(validateAnswerKey(prepared.question).ok).toBe(true);
      expect(prepared.question.correctAnswer.toLowerCase()).toContain('argatroban');
      const matches = (prepared.question.options || []).filter((opt) => opt === prepared.question.correctAnswer);
      expect(matches.length).toBe(1);
    }
  });
});

