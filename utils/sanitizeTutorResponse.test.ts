import { describe, it, expect } from 'vitest';
import { sanitizeTutorResponseForTest } from '../services/geminiService';

describe('sanitizeTutorResponse', () => {
  it('preserves tables and bullets and strips code fences', () => {
    const input = [
      '```',
      '| Option | Rationale |',
      '| --- | --- |',
      '| A | Correct; ... |',
      '```',
      '',
      '- Bullet one',
      '- Bullet two',
      '',
      '',
      '',
      'Q1) What is the key clue?'
    ].join('\n');

    const out = sanitizeTutorResponseForTest(input);
    expect(out).toContain('| Option | Rationale |');
    expect(out).toContain('- Bullet one');
    expect(out).toContain('Q1) What is the key clue?');
    expect(out).not.toContain('```');
    expect(out).not.toMatch(/\n{3,}/);
  });
});

