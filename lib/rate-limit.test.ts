import { describe, expect, it } from 'vitest';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('allows up to the limit inside the window, then blocks; window slides', () => {
    const k = 'k1';
    expect([1, 2, 3].map((i) => rateLimit(k, 2, 1000, i))).toEqual([true, true, false]);
    expect(rateLimit(k, 2, 1000, 1002)).toBe(true); // first hit aged out
  });

  it('keys are independent', () => {
    expect(rateLimit('a', 1, 1000, 0)).toBe(true);
    expect(rateLimit('b', 1, 1000, 0)).toBe(true);
    expect(rateLimit('a', 1, 1000, 1)).toBe(false);
  });
});
