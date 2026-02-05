import { describe, expect, it } from 'vitest';
import { formatMsAsMMSS } from './time';

describe('time', () => {
  it('formats ms as MM:SS with clamping', () => {
    expect(formatMsAsMMSS(0)).toBe('00:00');
    expect(formatMsAsMMSS(-1000)).toBe('00:00');
    expect(formatMsAsMMSS(1000)).toBe('00:01');
    expect(formatMsAsMMSS(61_000)).toBe('01:01');
    expect(formatMsAsMMSS(30 * 60 * 1000)).toBe('30:00');
  });
});

