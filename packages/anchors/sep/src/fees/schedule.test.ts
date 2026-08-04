import { describe, expect, it } from 'vitest';
import { quoteFromSchedule, type FeeScheduleEntry } from './schedule';

/*
 * Anclap's real published terms for Argentine pesos, as fetched from their
 * SEP-24 /info: a flat 10 plus 1%, between 11 and 500000. Using their actual
 * numbers means the test fails if the arithmetic ever stops matching what an
 * anchor would really charge.
 */
const ANCLAP_ARS: FeeScheduleEntry = {
  code: 'ARS',
  enabled: true,
  minAmount: '11',
  maxAmount: '500000',
  feeFixed: 10,
  feePercent: 1,
};

describe('quoteFromSchedule', () => {
  it("applies the anchor's fixed and percentage fee together", () => {
    // 1000 ARS: 10 flat + 1% of 1000 = 20 total, so 980 arrives.
    const result = quoteFromSchedule(ANCLAP_ARS, '1000');
    expect(result).not.toBeNull();
    expect(Number(result!.fee)).toBeCloseTo(20, 7);
    expect(Number(result!.buyAmount)).toBeCloseTo(980, 7);
  });

  /*
   * Quoting a number the anchor would reject is worse than admitting it does
   * not serve this size: the user acts on the quote and the order fails.
   */
  it('refuses amounts below the published minimum', () => {
    expect(quoteFromSchedule(ANCLAP_ARS, '5')).toBeNull();
  });

  it('refuses amounts above the published maximum', () => {
    expect(quoteFromSchedule(ANCLAP_ARS, '500001')).toBeNull();
  });

  it('accepts the boundaries themselves', () => {
    expect(quoteFromSchedule(ANCLAP_ARS, '11')).not.toBeNull();
    expect(quoteFromSchedule(ANCLAP_ARS, '500000')).not.toBeNull();
  });

  /* A fee that swallows the whole amount is not a quote, it is a rejection. */
  it('refuses when the fee would consume the amount', () => {
    expect(quoteFromSchedule({ code: 'X', enabled: true, feeFixed: 50 }, '50')).toBeNull();
  });

  it('handles a schedule with no fees at all', () => {
    const free = quoteFromSchedule({ code: 'X', enabled: true }, '100');
    expect(Number(free!.buyAmount)).toBe(100);
    expect(Number(free!.fee)).toBe(0);
  });

  it('rejects nonsense amounts rather than producing NaN', () => {
    expect(quoteFromSchedule(ANCLAP_ARS, 'abc')).toBeNull();
    expect(quoteFromSchedule(ANCLAP_ARS, '-100')).toBeNull();
  });
});
