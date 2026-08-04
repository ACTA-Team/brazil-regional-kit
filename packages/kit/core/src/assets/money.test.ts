import { describe, expect, it } from 'vitest';
import { add, applyBps, compare, divide, isPositive, multiply, round, subtract } from './money';

/**
 * Amounts are decimal strings end to end precisely so that float error never
 * reaches an anchor or the network. These tests pin the cases where a naive
 * float implementation would already be wrong.
 */
describe('decimal arithmetic', () => {
  it('adds without float error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float.
    expect(add('0.1', '0.2')).toBe('0.3');
  });

  it('subtracts without float error', () => {
    expect(subtract('1.1', '1')).toBe('0.1');
  });

  it('multiplies at Stellar precision', () => {
    expect(multiply('500', '0.985')).toBe('492.5');
    expect(multiply('1.0000001', '1')).toBe('1.0000001');
  });

  it('divides and trims trailing zeros', () => {
    expect(divide('10', '4')).toBe('2.5');
    expect(divide('1', '3')).toBe('0.3333333');
  });

  it('refuses to divide by zero', () => {
    expect(() => divide('1', '0')).toThrow('Division by zero');
  });

  it('rejects values that are not decimals', () => {
    expect(() => add('abc', '1')).toThrow('Not a decimal amount');
    expect(() => add('', '1')).toThrow();
    expect(() => add('1.2.3', '1')).toThrow();
  });

  it('handles negatives', () => {
    expect(subtract('1', '3')).toBe('-2');
    expect(add('-1.5', '0.5')).toBe('-1');
  });
});

describe('compare', () => {
  it('treats trailing zeros as equal', () => {
    expect(compare('10.5', '10.50')).toBe(0);
  });

  it('orders correctly at seven decimals', () => {
    expect(compare('0.0000002', '0.0000001')).toBe(1);
    expect(compare('0.0000001', '0.0000002')).toBe(-1);
  });

  it('backs isPositive', () => {
    expect(isPositive('0.0000001')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(isPositive('-1')).toBe(false);
  });
});

describe('applyBps', () => {
  it('computes a fee in basis points', () => {
    expect(applyBps('500', 120)).toBe('6'); // 1.2%
    expect(applyBps('100', 30)).toBe('0.3'); // 0.3%
  });

  it('returns zero for a zero fee', () => {
    expect(applyBps('500', 0)).toBe('0');
  });
});

describe('round', () => {
  it('truncates toward zero so we never over-promise a payout', () => {
    expect(round('1.9999999', 2)).toBe('1.99');
    expect(round('1.005', 2)).toBe('1');
  });
});
