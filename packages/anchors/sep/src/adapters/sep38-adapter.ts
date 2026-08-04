/**
 * A generic Stellar anchor adapter.
 *
 * Unlike the Etherfuse adapter, this one is not written against a single
 * company's API — it speaks the ecosystem standards, so it works against *any*
 * SEP-compliant anchor by changing one env var. That is the argument for
 * shaping `ramp-core` after the SEPs in the first place: the second anchor in
 * this kit cost a protocol client, not another integration.
 *
 * Default home domain is SDF's public test anchor, which needs no signup and no
 * key — so the router has a genuinely live competitor out of the box.
 */

import {
  RampError,
  divide,
  isFiat,
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
  type RampDirection,
  type SupportedCorridor,
} from '@brk/ramp-core';
import { Sep38Client, type Sep38Info } from '../sep38/prices';
import { fetchStellarToml, type StellarToml } from '../sep1/toml';

export const DEFAULT_HOME_DOMAIN = 'testanchor.stellar.org';

export interface SepAdapterConfig {
  mode: AdapterMode;
  /** Anchor's home domain — everything else is discovered from its stellar.toml. */
  homeDomain?: string;
  id?: string;
  name?: string;
  /** Country a fiat corridor belongs to, when the anchor does not say. */
  defaultCountry?: CountryCode;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Fixture used when `mode` is `mock`, so the adapter still answers offline. */
  mockPrices?: Record<string, { price: string; fee: string }>;
}

interface Discovery {
  toml: StellarToml;
  info: Sep38Info;
  client: Sep38Client;
  corridors: SupportedCorridor[];
}

export class SepAnchorAdapter implements RampAdapter {
  private readonly config: SepAdapterConfig;
  private readonly homeDomain: string;
  private discovery: Discovery | null = null;
  private discovering: Promise<Discovery> | null = null;
  /** Populated after the first successful discovery; drives `capabilities()`. */
  private knownCorridors: SupportedCorridor[] = [];

  constructor(config: SepAdapterConfig) {
    this.config = config;
    this.homeDomain = config.homeDomain ?? DEFAULT_HOME_DOMAIN;
  }

  get id(): string {
    return this.config.id ?? this.homeDomain.split('.')[0] ?? 'sep-anchor';
  }

  capabilities(): AdapterCapabilities {
    return {
      id: this.id,
      name: this.config.name ?? `${this.homeDomain} (SEP-38)`,
      mode: this.config.mode,
      countries: uniqueCountries(this.knownCorridors, this.config.defaultCountry),
      corridors: this.knownCorridors,
      features: {
        // Firm quotes exist but need a SEP-10 JWT; indicative ones do not.
        firmQuotes: true,
        orders: false,
        sandboxSimulation: false,
        interactive: Boolean(this.discovery?.toml.TRANSFER_SERVER_SEP0024),
      },
      note:
        this.config.mode === 'live'
          ? 'Live SEP-38 quotes. No API key, no KYC — SEP-38 price endpoints are unauthenticated by design.'
          : 'Replaying recorded SEP-38 prices.',
      docsUrl: `https://${this.homeDomain}/.well-known/stellar.toml`,
    };
  }

  /**
   * Read the TOML and `/info` once, then derive every corridor the anchor
   * serves. Concurrent callers share one in-flight discovery rather than each
   * firing their own pair of requests.
   */
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
    const toml = await fetchStellarToml(this.homeDomain, {
      fetchImpl: this.config.fetchImpl,
      timeoutMs: this.config.timeoutMs,
    });

    const quoteServer = toml.ANCHOR_QUOTE_SERVER;
    if (!quoteServer) {
      throw new RampError({
        code: 'UNSUPPORTED_PAIR',
        anchorId: this.id,
        message: `${this.homeDomain} does not advertise ANCHOR_QUOTE_SERVER — no SEP-38 support.`,
      });
    }

    const client = new Sep38Client({
      quoteServer,
      timeoutMs: this.config.timeoutMs,
      fetchImpl: this.config.fetchImpl,
    });

    const info = await client.info();
    const corridors = deriveCorridors(info, this.config.defaultCountry);
    this.knownCorridors = corridors;

    return { toml, info, client, corridors };
  }

  private deliveryMethods(
    info: Sep38Info,
    sellAsset: AssetId,
    buyAsset: AssetId,
  ): { sell?: string; buy?: string; country?: string } {
    const sell = info.assets.find((a) => a.asset === sellAsset);
    const buy = info.assets.find((a) => a.asset === buyAsset);
    return {
      sell: sell?.sell_delivery_methods?.[0]?.name,
      buy: buy?.buy_delivery_methods?.[0]?.name,
      country: sell?.country_codes?.[0] ?? buy?.country_codes?.[0],
    };
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const startedAt = Date.now();

    if (!req.sellAmount) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: this.id,
        message: 'SEP-38 pricing needs a sell amount.',
      });
    }

    const { client, info } = await this.discover();
    const methods = this.deliveryMethods(info, req.sellAsset, req.buyAsset);

    let price;
    try {
      price = await client.price({
        sellAsset: req.sellAsset,
        buyAsset: req.buyAsset,
        sellAmount: req.sellAmount,
        context: 'sep6',
        sellDeliveryMethod: methods.sell,
        buyDeliveryMethod: methods.buy,
        countryCode: req.country ?? methods.country,
      });
    } catch (e) {
      throw toRampError(e, this.id);
    }

    const direction: RampDirection = isFiat(req.sellAsset) ? 'onramp' : 'offramp';

    return {
      id: `${this.id}-${startedAt}-${Math.round(Number(price.buy_amount) * 1e4)}`,
      anchorId: this.id,
      anchorName: this.capabilities().name,
      mode: this.config.mode,
      direction,
      sellAsset: req.sellAsset,
      buyAsset: req.buyAsset,
      sellAmount: price.sell_amount ?? req.sellAmount,
      buyAmount: price.buy_amount,
      // `total_price` includes fees, so it is the rate the user actually gets.
      // Report the inverse so it reads as "buy units per sell unit", like every
      // other quote in the kit.
      price: safeInvert(price.total_price, price.buy_amount, price.sell_amount),
      fee: {
        amount: price.fee.total,
        asset: price.fee.asset,
        detail: price.fee.details?.map((d) => ({ name: d.name, amount: d.amount })),
      },
      // Indicative prices are not reserved. Treat them as short-lived so the UI
      // refreshes rather than showing a stale number as if it were locked in.
      expiresAt: new Date(startedAt + 60_000).toISOString(),
      latencyMs: Date.now() - startedAt,
      firmness: 'indicative',
      raw: price,
    };
  }

  /**
   * Ordering through this adapter means SEP-6 or SEP-24, both of which require
   * SEP-10 auth and a KYC round trip. The router only ever asks it for prices,
   * so rather than half-implement a deposit flow we fail loudly and point at
   * the interactive URL, which is the supported path.
   */
  async createOrder(_req: CreateOrderRequest): Promise<Order> {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: this.id,
      message:
        `${this.id} is integrated for SEP-38 quotes. To move funds, use its SEP-24 ` +
        `interactive flow via getInteractiveUrl().`,
    });
  }

  async getOrder(orderId: string): Promise<Order> {
    throw new RampError({
      code: 'INVALID_REQUEST',
      anchorId: this.id,
      message: `${this.id} does not expose order ${orderId} outside its interactive flow.`,
    });
  }

  /** SEP-24 interactive deposit/withdraw entry point. */
  async getInteractiveUrl(req: QuoteRequest): Promise<string> {
    const { toml } = await this.discover();
    const sep24 = toml.TRANSFER_SERVER_SEP0024;
    if (!sep24) {
      throw new RampError({
        code: 'INVALID_REQUEST',
        anchorId: this.id,
        message: `${this.homeDomain} does not advertise a SEP-24 transfer server.`,
      });
    }
    // The POST that starts an interactive session needs a SEP-10 JWT; the hub
    // handles that, this just resolves the endpoint from discovery.
    const direction = isFiat(req.sellAsset) ? 'deposit' : 'withdraw';
    return `${sep24}/transactions/${direction}/interactive`;
  }

  /** Exposed so the hub can reuse discovery for SEP-10 and SEP-24. */
  async metadata(): Promise<{ toml: StellarToml; info: Sep38Info }> {
    const { toml, info } = await this.discover();
    return { toml, info };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Turn a SEP-38 `/info` asset list into concrete corridors.
 *
 * SEP-38 describes assets, not pairs: an anchor says "I handle USD and USDC",
 * leaving the client to infer that USD↔USDC is tradeable. We pair every fiat
 * with every on-chain asset in both directions, which is what the price
 * endpoint will actually answer for.
 */
export function deriveCorridors(
  info: Sep38Info,
  defaultCountry?: CountryCode,
): SupportedCorridor[] {
  const fiats = info.assets.filter((a) => isFiat(a.asset));
  const onChain = info.assets.filter((a) => !isFiat(a.asset));
  const corridors: SupportedCorridor[] = [];

  for (const fiat of fiats) {
    const country = (fiat.country_codes?.[0] ?? defaultCountry) as CountryCode | undefined;
    if (!country) continue;
    const sellRail = fiat.sell_delivery_methods?.[0]?.name ?? 'bank';
    const buyRail = fiat.buy_delivery_methods?.[0]?.name ?? 'bank';

    for (const asset of onChain) {
      corridors.push({
        direction: 'onramp',
        sellAsset: fiat.asset,
        buyAsset: asset.asset,
        country,
        rail: sellRail,
      });
      corridors.push({
        direction: 'offramp',
        sellAsset: asset.asset,
        buyAsset: fiat.asset,
        country,
        rail: buyRail,
      });
    }
  }

  return corridors;
}

function uniqueCountries(corridors: SupportedCorridor[], fallback?: CountryCode): CountryCode[] {
  const set = new Set(corridors.map((c) => c.country));
  if (fallback) set.add(fallback);
  return [...set];
}

/** `total_price` is sell-per-buy; the kit reports buy-per-sell. */
function safeInvert(totalPrice: string, buyAmount: string, sellAmount: string): string {
  try {
    if (Number(totalPrice) > 0) return divide('1', totalPrice);
    return divide(buyAmount, sellAmount);
  } catch {
    return '0';
  }
}

export function createSepAdapter(config: SepAdapterConfig): SepAnchorAdapter {
  return new SepAnchorAdapter(config);
}
