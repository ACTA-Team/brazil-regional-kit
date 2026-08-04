/**
 * DEX swaps and the simulated fallback.
 *
 * The property that matters most: the kit must never present a made-up number
 * as if the order books had filled it. Every path below either reaches `dex`
 * with a real quote, or reaches `simulated` carrying the reason — never a
 * silent third thing.
 *
 * `server` is mocked because it is Horizon. The path selection, slippage floor
 * and mode decisions are the code under test and are real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TESOURO, USDC } from '@brk/ramp-core';
import { buildSwapTx, quoteSwap } from './swap';
import { server } from './horizon';

vi.mock('./horizon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./horizon')>()),
  server: vi.fn(),
}));

const ADDRESS = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';

type PathRecord = {
  destination_amount: string;
  path: Array<{ asset_code?: string; asset_issuer?: string }>;
};

/** A Horizon stand-in whose strict-send lookup returns exactly these records. */
function horizonWithPaths(records: PathRecord[]) {
  vi.mocked(server).mockReturnValue({
    strictSendPaths: () => ({ call: async () => ({ records }) }),
  } as unknown as ReturnType<typeof server>);
}

function horizonThatFails(message: string) {
  vi.mocked(server).mockReturnValue({
    strictSendPaths: () => ({
      call: async () => {
        throw new Error(message);
      },
    }),
  } as unknown as ReturnType<typeof server>);
}

const direct = (amount: string): PathRecord => ({ destination_amount: amount, path: [] });

beforeEach(() => {
  vi.mocked(server).mockReset();
});

describe('quoting against the order books', () => {
  it('quotes at the best available fill', async () => {
    horizonWithPaths([direct('90'), direct('102.5'), direct('99')]);

    const quote = await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' });

    expect(quote.mode).toBe('dex');
    expect(quote.buyAmount).toBe('102.5');
  });

  /** Records come back best-first, but ranking explicitly costs nothing. */
  it('does not simply trust Horizon’s ordering', async () => {
    horizonWithPaths([direct('50'), direct('200')]);

    expect(
      (await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' })).buyAmount,
    ).toBe('200');
  });

  it('reports the effective price as buy per sell unit', async () => {
    horizonWithPaths([direct('250')]);

    expect((await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' })).price).toBe(
      '2.5',
    );
  });

  /**
   * `destMin` is the floor the network enforces atomically — the swap fails
   * rather than filling below it. A wrong floor is real money.
   */
  it('sets the floor one slippage step below the quote', async () => {
    horizonWithPaths([direct('100')]);

    const quote = await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' });

    expect(quote.slippageBps).toBe(100);
    expect(quote.destMin).toBe('99');
  });

  it('honours a tighter slippage setting', async () => {
    horizonWithPaths([direct('100')]);

    const quote = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      slippageBps: 25,
    });

    expect(quote.destMin).toBe('99.75');
  });

  it('reports a direct market as an empty path', async () => {
    horizonWithPaths([direct('100')]);

    expect(
      (await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' })).path,
    ).toEqual([]);
  });

  it('maps intermediate hops into kit asset ids', async () => {
    horizonWithPaths([
      {
        destination_amount: '100',
        path: [
          { asset_code: 'XLM' },
          {
            asset_code: 'USDC',
            asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          },
        ],
      },
    ]);

    expect(
      (await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' })).path,
    ).toEqual([
      'stellar:native',
      'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    ]);
  });

  it('reports a rate of zero rather than dividing by it', async () => {
    horizonWithPaths([direct('100')]);

    expect((await quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '0' })).price).toBe(
      '0',
    );
  });
});

describe('the simulated fallback', () => {
  /** A thin testnet order book is normal, not an error — but it must be labelled. */
  it('prices off-book when no path exists, and says so', async () => {
    horizonWithPaths([]);

    const quote = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    expect(quote.mode).toBe('simulated');
    expect(quote.buyAmount).toBe('19');
    expect(quote.price).toBe('0.19');
    expect(quote.reason).toMatch(/No path/i);
  });

  /**
   * A Horizon outage reported as "no liquidity" sends whoever reads it hunting
   * for a market-maker problem that does not exist.
   */
  it('distinguishes a Horizon failure from an empty order book', async () => {
    horizonThatFails('503 Service Unavailable');

    const quote = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    expect(quote.mode).toBe('simulated');
    expect(quote.reason).toMatch(/Path lookup failed/i);
    expect(quote.reason).toMatch(/503/);
  });

  it('credits the source of the reference rate when one is given', async () => {
    horizonWithPaths([]);

    const quote = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
      referenceLabel: 'from the router mid-price',
    });

    expect(quote.reason).toContain('Priced from the router mid-price.');
  });

  /**
   * The refusal that keeps the whole thing honest: with no reference rate and
   * no order book, there is no number to show, so none is invented.
   */
  it('refuses to invent a rate when there is no reference price', async () => {
    horizonWithPaths([]);

    await expect(
      quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  it('refuses likewise when Horizon itself failed', async () => {
    horizonThatFails('ECONNREFUSED');

    await expect(
      quoteSwap({ sellAsset: TESOURO, buyAsset: USDC, sellAmount: '100' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAIR' });
  });

  /** No order book means no slippage protection to promise. */
  it('sets the floor equal to the amount, promising no protection it cannot give', async () => {
    horizonWithPaths([]);

    const quote = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    expect(quote.destMin).toBe(quote.buyAmount);
    expect(quote.path).toEqual([]);
  });
});

describe('input validation', () => {
  it('rejects swapping an asset for itself before touching the network', async () => {
    await expect(
      quoteSwap({ sellAsset: USDC, buyAsset: USDC, sellAmount: '100' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    expect(vi.mocked(server)).not.toHaveBeenCalled();
  });
});

describe('building the transaction', () => {
  /**
   * The one thing a simulated quote must never do is produce something
   * submittable — there is no path, so it would fail on-chain anyway.
   */
  it('refuses to build a transaction for a simulated quote', async () => {
    horizonWithPaths([]);

    const simulated = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    await expect(buildSwapTx(simulated, ADDRESS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PAIR',
    });
  });

  it('explains why, rather than failing anonymously', async () => {
    horizonWithPaths([]);

    const simulated = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    await expect(buildSwapTx(simulated, ADDRESS)).rejects.toThrow(/no path to execute/i);
  });

  it('does not load an account for a quote it will refuse', async () => {
    horizonWithPaths([]);

    const simulated = await quoteSwap({
      sellAsset: TESOURO,
      buyAsset: USDC,
      sellAmount: '100',
      referencePrice: '0.19',
    });

    vi.mocked(server).mockReset();
    await expect(buildSwapTx(simulated, ADDRESS)).rejects.toThrow();
    expect(vi.mocked(server)).not.toHaveBeenCalled();
  });
});
