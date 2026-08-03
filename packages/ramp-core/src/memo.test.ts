import { describe, expect, it } from 'vitest';
import { checkMemo, memoByteLength, truncateMemo, validateMemo } from './memo';
import { RampError } from './errors';

/**
 * The whole point of this module is that bytes ≠ characters. These tests use
 * real Portuguese and Spanish strings, because that is where the difference
 * actually bites — an English test suite would pass while the product loses
 * memos in production.
 */
describe('memo byte counting', () => {
  it('counts ASCII as one byte per character', () => {
    expect(memoByteLength('Para a familia')).toBe(14);
  });

  it('counts accented characters as more than one byte', () => {
    // 21 characters, 23 bytes — ê and í cost two each.
    expect('Transferência família'.length).toBe(21);
    expect(memoByteLength('Transferência família')).toBe(23);
  });

  it('reports remaining space in bytes, not characters', () => {
    const check = checkMemo('Transferência família');
    expect(check).toMatchObject({ valid: true, bytes: 23, max: 28, remaining: 5 });
  });

  it('flags a memo that fits in characters but not in bytes', () => {
    const memo = 'Para meus avós em Guadalajara'; // 29 chars, 30 bytes
    expect(memo.length).toBe(29);
    expect(checkMemo(memo)).toMatchObject({ valid: false, bytes: 30, remaining: -2 });
  });

  it('accepts exactly 28 bytes', () => {
    expect(checkMemo('a'.repeat(28)).valid).toBe(true);
    expect(checkMemo('a'.repeat(29)).valid).toBe(false);
  });
});

describe('validateMemo', () => {
  it('returns the memo unchanged when it fits', () => {
    expect(validateMemo('Para a familia')).toBe('Para a familia');
  });

  it('throws rather than truncating — silent truncation loses the payment', () => {
    expect(() => validateMemo('Para meus avós em Guadalajara')).toThrow(RampError);
  });

  it('explains the byte cost in the error, not just "too long"', () => {
    try {
      validateMemo('Para meus avós em Guadalajara');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as RampError).code).toBe('INVALID_REQUEST');
      expect((e as RampError).message).toContain('30 bytes');
      expect((e as RampError).message).toContain('Accented');
    }
  });
});

describe('truncateMemo', () => {
  it('leaves a short memo alone', () => {
    expect(truncateMemo('short')).toBe('short');
  });

  it('never splits a multi-byte character', () => {
    const truncated = truncateMemo('ção'.repeat(20));
    expect(memoByteLength(truncated)).toBeLessThanOrEqual(28);
    // A split UTF-8 sequence would decode to U+FFFD.
    expect(truncated).not.toContain('�');
    expect(truncated.endsWith('o') || truncated.endsWith('ç') || truncated.endsWith('ã')).toBe(
      true,
    );
  });
});
