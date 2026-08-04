/**
 * Horizon access: balances, trustlines, transaction submission.
 *
 * Deliberately thin. The kit's job is not to re-wrap the Stellar SDK, it is to
 * answer the handful of questions a ramp integration actually asks — "can this
 * account hold TESOURO yet?", "did the burn land?" — and to keep submission in
 * one place so retry and error mapping are consistent.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  HORIZON_TESTNET,
  RampError,
  TESTNET_PASSPHRASE,
  isNative,
  parseAsset,
  validateMemo,
  type AssetId,
} from '@brk/ramp-core';

export interface NetworkConfig {
  horizonUrl: string;
  networkPassphrase: string;
}

export const TESTNET: NetworkConfig = {
  horizonUrl: HORIZON_TESTNET,
  networkPassphrase: TESTNET_PASSPHRASE,
};

export function server(config: NetworkConfig = TESTNET): Horizon.Server {
  return new Horizon.Server(config.horizonUrl);
}

/** `stellar:USDC:GBBD…` → an SDK `Asset`. */
export function toSdkAsset(id: AssetId): Asset {
  if (isNative(id)) return Asset.native();
  const { code, issuer } = parseAsset(id);
  if (!issuer) {
    throw new RampError({ code: 'INVALID_REQUEST', message: `Asset ${id} has no issuer.` });
  }
  return new Asset(code, issuer);
}

export interface Balance {
  asset: AssetId;
  code: string;
  issuer?: string;
  balance: string;
  /** How much of the balance the account may actually spend. */
  spendable: string;
  limit?: string;
}

/**
 * Returns `null` when the account does not exist yet (unfunded), rather than
 * throwing — "no account" is a normal state a ramp UI must render, not an error.
 */
export async function getBalances(
  address: string,
  config: NetworkConfig = TESTNET,
): Promise<Balance[] | null> {
  try {
    const account = await server(config).loadAccount(address);
    return account.balances.map((b): Balance => {
      if (b.asset_type === 'native') {
        // 1 XLM base reserve + 0.5 per subentry, kept back by the protocol.
        const reserved = 1 + 0.5 * account.subentry_count;
        const spendable = Math.max(0, Number(b.balance) - reserved).toFixed(7);
        return { asset: 'stellar:native', code: 'XLM', balance: b.balance, spendable };
      }
      const code = 'asset_code' in b ? b.asset_code : '';
      const issuer = 'asset_issuer' in b ? b.asset_issuer : undefined;
      return {
        asset: `stellar:${code}:${issuer}`,
        code,
        issuer,
        balance: b.balance,
        spendable: b.balance,
        limit: 'limit' in b ? b.limit : undefined,
      };
    });
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw new RampError({
      code: 'CHAIN_ERROR',
      message: `Could not load account ${address}: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

export async function hasTrustline(
  address: string,
  asset: AssetId,
  config: NetworkConfig = TESTNET,
): Promise<boolean> {
  if (isNative(asset)) return true;
  const balances = await getBalances(address, config);
  if (!balances) return false;
  return balances.some((b) => b.asset === asset);
}

/**
 * Build an unsigned trustline transaction. The kit builds it rather than the
 * anchor so the on-ramp works even against anchors that never send a claim XDR.
 */
export async function buildTrustlineTx(
  address: string,
  asset: AssetId,
  config: NetworkConfig = TESTNET,
): Promise<string> {
  const account = await loadAccountOrThrow(address, config);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: toSdkAsset(asset) }))
    .setTimeout(180)
    .build()
    .toXDR();
}

export interface PaymentInput {
  from: string;
  to: string;
  asset: AssetId;
  amount: string;
  /** MEMO_TEXT. Validated against the 28-byte limit before it can reach the network. */
  memo?: string;
}

/** Build an unsigned payment. Also used for the off-ramp return to the anchor. */
export async function buildPaymentTx(
  input: PaymentInput,
  config: NetworkConfig = TESTNET,
): Promise<string> {
  const account = await loadAccountOrThrow(input.from, config);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  }).addOperation(
    Operation.payment({
      destination: input.to,
      asset: toSdkAsset(input.asset),
      amount: input.amount,
    }),
  );

  if (input.memo) builder.addMemo(Memo.text(validateMemo(input.memo)));

  return builder.setTimeout(180).build().toXDR();
}

export interface SubmitResult {
  hash: string;
  successful: boolean;
  ledger?: number;
}

/**
 * Submit a signed XDR. Horizon's failure payloads bury the useful part four
 * levels deep in `extras.result_codes`, so we surface it: `tx_bad_seq` and
 * `op_no_trust` are things a user can act on, `Request failed with status 400`
 * is not.
 */
export async function submitTransaction(
  signedXdr: string,
  config: NetworkConfig = TESTNET,
): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  try {
    const res = await server(config).submitTransaction(tx);
    return { hash: res.hash, successful: res.successful, ledger: res.ledger };
  } catch (e) {
    const extras = (
      e as { response?: { data?: { extras?: { result_codes?: Record<string, unknown> } } } }
    )?.response?.data?.extras;
    const codes = extras?.result_codes;
    const detail = codes ? JSON.stringify(codes) : e instanceof Error ? e.message : String(e);
    throw new RampError({
      code: 'CHAIN_ERROR',
      message: `Transaction rejected by the network: ${detail}`,
      raw: extras,
      cause: e,
    });
  }
}

export const explorerTxUrl = (hash: string, network = 'testnet'): string =>
  `https://stellar.expert/explorer/${network}/tx/${hash}`;

export const explorerAccountUrl = (address: string, network = 'testnet'): string =>
  `https://stellar.expert/explorer/${network}/account/${address}`;

async function loadAccountOrThrow(address: string, config: NetworkConfig) {
  try {
    return await server(config).loadAccount(address);
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      throw new RampError({
        code: 'CHAIN_ERROR',
        message: `Account ${address} does not exist on the network yet — fund it with friendbot first.`,
        cause: e,
      });
    }
    throw new RampError({
      code: 'CHAIN_ERROR',
      message: e instanceof Error ? e.message : String(e),
      cause: e,
    });
  }
}

export { Networks };
