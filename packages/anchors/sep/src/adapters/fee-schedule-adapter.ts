/**
 * A live anchor that quotes from its published fee schedule.
 *
 * Probing the ecosystem turned up exactly one public SEP-38 quote server, and a
 * long tail of real regional anchors that publish everything else: a
 * stellar.toml naming their issued assets, and an unauthenticated SEP-24 or
 * SEP-6 `/info` with limits and fees. Anclap serves Argentina and Peru that way.
 *
 * So this adapter speaks the protocol those anchors actually implement. Their
 * assets are pegged — Anclap's ARS token is one Argentine peso — so a deposit of
 * X fiat yields X minus the fee they publish. Every number comes from the
 * anchor, live; the only thing this code contributes is arithmetic.
 *
 * Two honesty constraints are built in rather than documented and forgotten:
 *
 *   - Quotes are `indicative`. Published terms are not a reserved price. Only
 *     SEP-38 `/quote` gives a firm one, and these anchors do not offer it.
 *   - `network` is surfaced in capabilities. Most of these anchors live on
 *     mainnet, so a testnet app can read their real prices but cannot settle
 *     against them, and a UI that hides that distinction is lying by omission.
 */

import {
  RampError,
  fiat,
  stellarAsset,
  toRampError,
  type AdapterCapabilities,
  type AdapterMode,
  type AssetId,
  type CountryCode,
  type CreateOrderRequest,
  type Order,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
  type SupportedCorridor,
} from '@brk/ramp-core';
import {
  fetchFeeSchedule,
  quoteFromSchedule,
  type FeeSchedule,
  type FeeScheduleEntry,
} from '../fees/schedule';
import { fetchStellarToml, type StellarToml } from '../sep1/toml';

export interface SepFeeAdapterConfig {
  mode: AdapterMode;
  homeDomain: string;
  id: string;
  name: string;
  /** Country these corridors belong to, for the router's per-country filter. */
  country: CountryCode;
  /** Local payment rail, shown next to the corridor. */
  rail?: string;
  docsUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface Discovery {
  toml: StellarToml;
  schedule: FeeSchedule;
  /** Issuer per asset code, read from the anchor's own CURRENCIES entries. */
  issuers: Map<string, string>;
  network: 'mainnet' | 'testnet';
  corridors: SupportedCorridor[];
}

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export class SepFeeAnchorAdapter implements RampAdapter {
  private readonly config: SepFeeAdapterConfig;
  private discovery: Discovery | null = null;
  private discovering: Promise<Discovery> | null = null;
  private knownCorridors: SupportedCorridor[] = [];
  private network: 'mainnet' | 'testnet' = 'mainnet';

  constructor(config: SepFeeAdapterConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  capabilities(): AdapterCapabilities {
    return {
      id: this.config.id,
      name: this.config.name,
      mode: this.config.mode,
      network: this.network,
      countries: [this.config.country],
      corridors: this.knownCorridors,
      features: {
        // Published terms, not a reserved price.
        firmQuotes: false,
        // Ordering means SEP-10 plus the anchor's interactive KYC, which needs
        // an account on the anchor's own network.
        orders: false,
        sandboxSimulation: false,
        interactive: Boolean(this.discovery?.toml.TRANSFER_SERVER_SEP0024),
      },
      note: `Live quotes from ${this.config.homeDomain}'s published SEP-24 fee schedule.`,
      docsUrl: this.config.docsUrl ?? `https://${this.config.homeDomain}`,
    };
  }

  /** Read the TOML and `/info` once; concurrent callers share the request. */
  async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    this.discovering ??= this.runDiscovery();
    try {
      this.discovery = await this.discovering;
      return this.discovery;
    } finally {
      this.discovering = null;
    }
  }

  private async runDiscovery(): Promise<Discovery> {
    const toml = await fetchStellarToml(this.config.homeDomain, {
      fetchImpl: this.config.fetchImpl,
      timeoutMs: this.config.timeoutMs,
    });

    const transferServer = toml.TRANSFER_SERVER_SEP0024 ?? toml.TRANSFER_SERVER;
    if (!transferServer) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: this.id,
        message: `${this.config.homeDomain} advertises no SEP-24 or SEP-6 transfer server.`,
      });
    }

    const schedule = await fetchFeeSchedule(transferServer, this.config.timeoutMs);
    if (!schedule) {
      throw new RampError({
        code: 'ANCHOR_UNAVAILABLE',
        anchorId: this.id,
        message: `${this.config.homeDomain} did not answer /info with a usable fee schedule.`,
      });
    }

    const issuers = new Map<string, string>();
    for (const currency of toml.CURRENCIES ?? []) {
      if (currency.code && currency.issuer) issuers.set(currency.code, currency.issuer);
    }

    this.network = toml.NETWORK_PASSPHRASE === MAINNET_PASSPHRASE ? 'mainnet' : 'testnet';

    const corridors = this.deriveCorridors(schedule, issuers);
    this.knownCorridors = corridors;

    return { toml, schedule, issuers, network: this.network, corridors };
  }

  /**
   * A deposit corridor is fiat in, the anchor's own pegged token out; a
   * withdraw corridor is the reverse. Assets the anchor lists but does not
   * issue are skipped, since without an issuer there is nothing to name.
   */
  private deriveCorridors(
    schedule: FeeSchedule,
    issuers: Map<string, string>,
  ): SupportedCorridor[] {
    const corridors: SupportedCorridor[] = [];

    for (const entry of schedule.deposit) {
      const issuer = issuers.get(entry.code);
      if (!issuer) continue;
      corridors.push({
        direction: 'onramp',
        sellAsset: fiat(entry.code),
        buyAsset: stellarAsset(entry.code, issuer),
        country: this.config.country,
        rail: this.config.rail ?? 'bank',
        min: entry.minAmount,
        max: entry.maxAmount,
      });
    }

    for (const entry of schedule.withdraw) {
      const issuer = issuers.get(entry.code);
      if (!issuer) continue;
      corridors.push({
        direction: 'offramp',
        sellAsset: stellarAsset(entry.code, issuer),
        buyAsset: fiat(entry.code),
        country: this.config.country,
        rail: this.config.rail ?? 'bank',
        min: entry.minAmount,
        max: entry.maxAmount,
      });
    }

    return corridors;
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const startedAt = Date.now();
    try {
      const { schedule } = await this.discover();

      const corridor = this.knownCorridors.find(
        (c) => c.sellAsset === req.sellAsset && c.buyAsset === req.buyAsset,
      );
      if (!corridor) {
        throw new RampError({
          code: 'UNSUPPORTED_PAIR',
          anchorId: this.id,
          message: `${this.config.name} does not serve ${req.sellAsset} → ${req.buyAsset}.`,
        });
      }

      const side = corridor.direction === 'onramp' ? schedule.deposit : schedule.withdraw;
      const code = corridor.direction === 'onramp' ? codeOf(req.sellAsset) : codeOf(req.buyAsset);
      const entry = side.find((e: FeeScheduleEntry) => e.code === code);

      const amount = req.sellAmount;
      if (!entry || !amount) {
        throw new RampError({
          code: 'UNSUPPORTED_PAIR',
          anchorId: this.id,
          message: `${this.config.name} publishes no terms for ${code}.`,
        });
      }

      const result = quoteFromSchedule(entry, amount);
      if (!result) {
        throw new RampError({
          code: 'AMOUNT_OUT_OF_RANGE',
          anchorId: this.id,
          message:
            `${this.config.name} accepts ${entry.minAmount ?? '0'}–${entry.maxAmount ?? '∞'} ` +
            `${code}; ${amount} is outside that.`,
        });
      }

      // Pegged asset: the price is one-to-one and the fee is the whole spread.
      const price = (Number(result.buyAmount) / Number(amount)).toFixed(7);

      return {
        id: `${this.id}-${Date.now()}`,
        anchorId: this.id,
        anchorName: this.config.name,
        mode: this.config.mode,
        direction: corridor.direction,
        sellAsset: req.sellAsset,
        buyAsset: req.buyAsset,
        sellAmount: amount,
        buyAmount: result.buyAmount,
        price,
        fee: { amount: result.fee, asset: req.sellAsset },
        // Published terms hold until the anchor changes them, which it may do
        // at any time. Claiming a specific expiry would be inventing one.
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        latencyMs: Date.now() - startedAt,
        firmness: 'indicative',
      };
    } catch (e) {
      throw toRampError(e, this.id);
    }
  }

  async createOrder(_req: CreateOrderRequest): Promise<Order> {
    throw new RampError({
      code: 'UNSUPPORTED_PAIR',
      anchorId: this.id,
      message:
        `${this.config.name} takes orders through its own SEP-24 interactive flow, which ` +
        `requires SEP-10 authentication against a ${this.network} account.`,
    });
  }

  async getOrder(orderId: string): Promise<Order> {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: this.id,
      message: `${this.config.name} does not expose order ${orderId} outside its own flow.`,
    });
  }
}

function codeOf(asset: AssetId): string {
  const [, code] = asset.split(':');
  return code ?? asset;
}

export function createSepFeeAdapter(config: SepFeeAdapterConfig): SepFeeAnchorAdapter {
  return new SepFeeAnchorAdapter(config);
}
