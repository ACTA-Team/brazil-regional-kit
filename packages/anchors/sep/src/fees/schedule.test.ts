import { describe, expect, it, vi } from 'vitest';
import { fetchFeeSchedule, quoteFromSchedule, type FeeScheduleEntry } from './schedule';

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

/**
 * Reading the schedule off a live anchor.
 *
 * The contract is that this never throws: an anchor that does not answer, or
 * answers with something unusable, is one the router reports as unreachable —
 * not one that takes the whole request down with it. So every hostile response
 * below has to come back as `null`.
 */
describe('fetchFeeSchedule', () => {
  const TRANSFER_SERVER = 'https://api.anchor.test/sep24';

  const fetchReturning = (body: unknown, status = 200): typeof fetch =>
    vi.fn(async () =>
      typeof body === 'string'
        ? new Response(body, { status })
        : new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;

  const INFO = {
    deposit: {
      ARS: { enabled: true, min_amount: 11, max_amount: 500000, fee_fixed: 10, fee_percent: 1 },
    },
    withdraw: { ARS: { enabled: true, fee_fixed: 5 } },
  };

  it('parses both sides of a published schedule', async () => {
    const schedule = await fetchFeeSchedule(TRANSFER_SERVER, 8000, fetchReturning(INFO));

    expect(schedule?.deposit).toEqual([
      {
        code: 'ARS',
        enabled: true,
        minAmount: '11',
        maxAmount: '500000',
        feeFixed: 10,
        feePercent: 1,
      },
    ]);
    expect(schedule?.withdraw).toEqual([
      {
        code: 'ARS',
        enabled: true,
        minAmount: undefined,
        maxAmount: undefined,
        feeFixed: 5,
        feePercent: undefined,
      },
    ]);
  });

  it('requests /info from the transfer server, trimming trailing slashes', async () => {
    const fetchImpl = fetchReturning(INFO);
    await fetchFeeSchedule(`${TRANSFER_SERVER}//`, 8000, fetchImpl);

    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toBe(`${TRANSFER_SERVER}/info`);
  });

  /** An asset the anchor has switched off is not a corridor it serves. */
  it('drops entries the anchor has disabled', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: { enabled: true }, BRL: { enabled: false } } }),
    );

    expect(schedule?.deposit.map((e) => e.code)).toEqual(['ARS']);
  });

  it('treats an entry with no `enabled` flag as enabled', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: {} } }),
    );

    expect(schedule?.deposit[0]).toMatchObject({ code: 'ARS', enabled: true });
  });

  it('reports an absent side as empty rather than undefined', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: { enabled: true } } }),
    );

    expect(schedule?.withdraw).toEqual([]);
  });

  /**
   * A fee that will not parse must not reach the arithmetic — `quoteFromSchedule`
   * would turn NaN into a nonsense quote rather than a refusal.
   */
  it('discards a fee that is not a number instead of carrying NaN into a quote', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: { enabled: true, fee_fixed: 'free' } } }),
    );

    expect(schedule?.deposit[0]?.feeFixed).toBeUndefined();
  });

  /** `Number(null)` is 0, so an explicitly null fee reads as "no fee", not "unknown". */
  it('reads an explicitly null fee as zero', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: { enabled: true, fee_percent: null } } }),
    );

    expect(schedule?.deposit[0]?.feePercent).toBe(0);
  });

  it('accepts limits published as numbers or as strings', async () => {
    const schedule = await fetchFeeSchedule(
      TRANSFER_SERVER,
      8000,
      fetchReturning({ deposit: { ARS: { enabled: true, min_amount: 11, max_amount: '500000' } } }),
    );

    expect(schedule?.deposit[0]).toMatchObject({ minAmount: '11', maxAmount: '500000' });
  });

  it('returns null when the anchor answers with an error status', async () => {
    await expect(
      fetchFeeSchedule(TRANSFER_SERVER, 8000, fetchReturning({}, 503)),
    ).resolves.toBeNull();
  });

  /** Anchors under load serve HTML error pages more often than anyone would like. */
  it('returns null for an HTML error page rather than throwing a parse error', async () => {
    await expect(
      fetchFeeSchedule(TRANSFER_SERVER, 8000, fetchReturning('<html>502 Bad Gateway</html>')),
    ).resolves.toBeNull();
  });

  it('returns null for an empty body', async () => {
    await expect(fetchFeeSchedule(TRANSFER_SERVER, 8000, fetchReturning(''))).resolves.toBeNull();
  });

  it('returns null for malformed JSON that still looks like an object', async () => {
    await expect(
      fetchFeeSchedule(TRANSFER_SERVER, 8000, fetchReturning('{"deposit": ')),
    ).resolves.toBeNull();
  });

  it('returns null when the anchor is unreachable', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(fetchFeeSchedule(TRANSFER_SERVER, 8000, boom)).resolves.toBeNull();
  });

  /** An anchor that hangs must not stall the router behind it. */
  it('gives up on an anchor that never answers', async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(fetchFeeSchedule(TRANSFER_SERVER, 10, hang)).resolves.toBeNull();
  });
});
