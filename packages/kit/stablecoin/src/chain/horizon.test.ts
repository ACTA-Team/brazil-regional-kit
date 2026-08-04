/**
 * The thin Horizon layer: balances, trustlines, transaction building, submission.
 *
 * Horizon itself is stubbed — it is the external dependency. What is tested for
 * real is everything the kit adds on top: the reserve arithmetic that decides
 * how much a user can actually spend, the 404-is-not-an-error rule, the memo
 * guard on the payment path, and the error surfacing that turns Horizon's
 * buried `result_codes` into something a user can act on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { TESOURO, USDC } from '@brk/ramp-core';
import {
  TESTNET,
  buildPaymentTx,
  buildTrustlineTx,
  explorerAccountUrl,
  explorerTxUrl,
  getBalances,
  hasTrustline,
  submitTransaction,
  toSdkAsset,
} from './horizon';

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return { ...actual, Horizon: { ...actual.Horizon, Server: vi.fn() } };
});

const ADDRESS = 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const ServerMock = vi.mocked(Horizon.Server);

/**
 * Give the next `new Horizon.Server(...)` these behaviours. It has to be a
 * `function`, not an arrow — the code under test calls it with `new`.
 */
function stubServer(impl: Record<string, unknown>) {
  (ServerMock as unknown as { mockImplementation(fn: () => unknown): void }).mockImplementation(
    function stub() {
      return impl;
    },
  );
}

/**
 * `fromXDR` can also return a fee-bump envelope. Nothing this kit builds is one,
 * so narrow once here rather than at every assertion.
 */
const parseTx = (xdr: string): Transaction =>
  TransactionBuilder.fromXDR(xdr, TESTNET.networkPassphrase) as Transaction;

const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });

/** A funded account the SDK will accept as a transaction source. */
const sourceAccount = () => new Account(ADDRESS, '1');

beforeEach(() => {
  ServerMock.mockReset();
});

describe('asset translation', () => {
  it('maps the native id to XLM', () => {
    expect(toSdkAsset('stellar:native').isNative()).toBe(true);
  });

  it('maps a credit asset to its code and issuer', () => {
    const asset = toSdkAsset(USDC);
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(ISSUER);
  });

  /**
   * An issuer-less credit asset is rejected by `parseAsset` before `toSdkAsset`
   * reaches its own guard, so the error is a plain one rather than a RampError.
   * What matters for safety is that it refuses and names the offending id —
   * a silently malformed `Asset` would send a payment nowhere.
   */
  it('refuses an asset id with no issuer rather than building a broken Asset', () => {
    expect(() => toSdkAsset('stellar:USDC' as never)).toThrow(/stellar:USDC/);
  });
});

describe('balances', () => {
  /**
   * An account that does not exist yet is a normal state a ramp UI has to
   * render — "fund me first" — not an error to throw at the user.
   */
  it('reports an unfunded account as null, not as a failure', async () => {
    stubServer({
      loadAccount: async () => {
        throw notFound;
      },
    });

    await expect(getBalances(ADDRESS)).resolves.toBeNull();
  });

  it('surfaces any other Horizon failure as a CHAIN_ERROR', async () => {
    stubServer({
      loadAccount: async () => {
        throw new Error('gateway timeout');
      },
    });

    await expect(getBalances(ADDRESS)).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
      message: expect.stringContaining('gateway timeout'),
    });
  });

  /**
   * The protocol holds back 1 XLM plus 0.5 per subentry. Showing the raw
   * balance as spendable means a user is told they have funds the network will
   * refuse to let them send.
   */
  it('subtracts the base reserve and per-subentry reserve from spendable XLM', async () => {
    stubServer({
      loadAccount: async () => ({
        subentry_count: 2,
        balances: [{ asset_type: 'native', balance: '10.0000000' }],
      }),
    });

    const balances = await getBalances(ADDRESS);

    expect(balances?.[0]).toMatchObject({
      asset: 'stellar:native',
      code: 'XLM',
      balance: '10.0000000',
      spendable: '8.0000000',
    });
  });

  it('never reports negative spendable XLM', async () => {
    stubServer({
      loadAccount: async () => ({
        subentry_count: 10,
        balances: [{ asset_type: 'native', balance: '1.0000000' }],
      }),
    });

    expect((await getBalances(ADDRESS))?.[0]?.spendable).toBe('0.0000000');
  });

  it('maps a credit balance with its issuer, limit and asset id', async () => {
    stubServer({
      loadAccount: async () => ({
        subentry_count: 1,
        balances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: ISSUER,
            balance: '250.5000000',
            limit: '922337203685.4775807',
          },
        ],
      }),
    });

    expect((await getBalances(ADDRESS))?.[0]).toEqual({
      asset: USDC,
      code: 'USDC',
      issuer: ISSUER,
      balance: '250.5000000',
      spendable: '250.5000000',
      limit: '922337203685.4775807',
    });
  });

  it('returns an empty list for an account holding nothing', async () => {
    stubServer({ loadAccount: async () => ({ subentry_count: 0, balances: [] }) });

    await expect(getBalances(ADDRESS)).resolves.toEqual([]);
  });
});

describe('trustlines', () => {
  /** Every account can hold XLM; asking Horizon would be a wasted round trip. */
  it('answers for the native asset without calling Horizon', async () => {
    await expect(hasTrustline(ADDRESS, 'stellar:native')).resolves.toBe(true);
    expect(ServerMock).not.toHaveBeenCalled();
  });

  it('is false for an account that does not exist yet', async () => {
    stubServer({
      loadAccount: async () => {
        throw notFound;
      },
    });

    await expect(hasTrustline(ADDRESS, TESOURO)).resolves.toBe(false);
  });

  it('is true only for an asset the account actually holds', async () => {
    stubServer({
      loadAccount: async () => ({
        subentry_count: 1,
        balances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: ISSUER,
            balance: '0',
          },
        ],
      }),
    });

    await expect(hasTrustline(ADDRESS, USDC)).resolves.toBe(true);
    await expect(hasTrustline(ADDRESS, TESOURO)).resolves.toBe(false);
  });

  it('builds a trustline transaction for the requested asset', async () => {
    stubServer({ loadAccount: async () => sourceAccount() });

    const xdr = await buildTrustlineTx(ADDRESS, USDC);
    const tx = parseTx(xdr);

    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]?.type).toBe('changeTrust');
    expect(tx.source).toBe(ADDRESS);
  });

  /** "Not found" here has one fix, and naming it saves a support round trip. */
  it('tells an unfunded account to use friendbot rather than reporting a bare 404', async () => {
    stubServer({
      loadAccount: async () => {
        throw notFound;
      },
    });

    await expect(buildTrustlineTx(ADDRESS, USDC)).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
      message: expect.stringMatching(/friendbot/i),
    });
  });

  it('normalizes any other load failure to a CHAIN_ERROR', async () => {
    stubServer({
      loadAccount: async () => {
        throw new Error('horizon exploded');
      },
    });

    await expect(buildTrustlineTx(ADDRESS, USDC)).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
      message: 'horizon exploded',
    });
  });
});

describe('payments', () => {
  beforeEach(() => {
    stubServer({ loadAccount: async () => sourceAccount() });
  });

  it('builds a payment carrying the amount, destination and asset', async () => {
    const xdr = await buildPaymentTx({
      from: ADDRESS,
      to: ISSUER,
      asset: USDC,
      amount: '25.5',
    });
    const tx = parseTx(xdr);
    const op = tx.operations[0] as {
      type: string;
      destination: string;
      amount: string;
      asset: Asset;
    };

    expect(op.type).toBe('payment');
    expect(op.destination).toBe(ISSUER);
    expect(op.amount).toBe('25.5000000');
    expect(op.asset.getCode()).toBe('USDC');
  });

  it('attaches a memo when one is supplied', async () => {
    const xdr = await buildPaymentTx({
      from: ADDRESS,
      to: ISSUER,
      asset: USDC,
      amount: '1',
      memo: 'order-123',
    });

    expect(parseTx(xdr).memo.value?.toString()).toBe('order-123');
  });

  it('leaves the memo empty when none is supplied', async () => {
    const xdr = await buildPaymentTx({ from: ADDRESS, to: ISSUER, asset: USDC, amount: '1' });

    expect(parseTx(xdr).memo.value).toBeNull();
  });

  /**
   * The expensive gotcha this kit exists to prevent: an over-long memo does not
   * bounce, it lands truncated and the anchor never credits the customer.
   * Accented Portuguese text is exactly how a 28-character memo becomes 30 bytes.
   */
  it('refuses an over-long memo rather than letting it truncate on-chain', async () => {
    await expect(
      buildPaymentTx({
        from: ADDRESS,
        to: ISSUER,
        asset: USDC,
        amount: '1',
        memo: 'Transferência para a família Conceição',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('accepts a memo that is long in characters but fits in bytes', async () => {
    await expect(
      buildPaymentTx({
        from: ADDRESS,
        to: ISSUER,
        asset: USDC,
        amount: '1',
        memo: 'abcdefghijklmnopqrstuvwxyz12',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('submission', () => {
  /** A genuinely signed transaction, so `fromXDR` parses it as the real code would. */
  const signedXdr = () => {
    const keypair = Keypair.random();
    const tx = new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: ISSUER, asset: Asset.native(), amount: '1' }))
      .setTimeout(180)
      .build();
    tx.sign(keypair);
    return tx.toXDR();
  };

  it('returns the hash and ledger on success', async () => {
    stubServer({
      submitTransaction: async () => ({ hash: 'abc123', successful: true, ledger: 42 }),
    });

    await expect(submitTransaction(signedXdr())).resolves.toEqual({
      hash: 'abc123',
      successful: true,
      ledger: 42,
    });
  });

  /**
   * Horizon buries the actionable part four levels deep. `tx_bad_seq` and
   * `op_no_trust` are things a user can fix; "Request failed with status 400"
   * is not.
   */
  it('surfaces Horizon’s result_codes instead of a generic status message', async () => {
    stubServer({
      submitTransaction: async () => {
        throw {
          response: {
            data: {
              extras: { result_codes: { transaction: 'tx_failed', operations: ['op_no_trust'] } },
            },
          },
        };
      },
    });

    await expect(submitTransaction(signedXdr())).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
      message: expect.stringContaining('op_no_trust'),
    });
  });

  it('falls back to the error message when Horizon sends no result codes', async () => {
    stubServer({
      submitTransaction: async () => {
        throw new Error('socket hang up');
      },
    });

    await expect(submitTransaction(signedXdr())).rejects.toMatchObject({
      code: 'CHAIN_ERROR',
      message: expect.stringContaining('socket hang up'),
    });
  });

  it('keeps the raw extras for debugging', async () => {
    const extras = { result_codes: { transaction: 'tx_bad_seq' } };
    stubServer({
      submitTransaction: async () => {
        throw { response: { data: { extras } } };
      },
    });

    await expect(submitTransaction(signedXdr())).rejects.toMatchObject({ raw: extras });
  });
});

describe('explorer links', () => {
  it('links a transaction on testnet by default', () => {
    expect(explorerTxUrl('abc')).toBe('https://stellar.expert/explorer/testnet/tx/abc');
  });

  it('links an account on the named network', () => {
    expect(explorerAccountUrl(ADDRESS, 'public')).toBe(
      `https://stellar.expert/explorer/public/account/${ADDRESS}`,
    );
  });
});
