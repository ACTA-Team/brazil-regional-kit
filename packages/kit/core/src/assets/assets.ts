/**
 * Asset identification, SEP-38 style.
 *
 * Every asset in this kit is a string in one of three shapes:
 *   - `iso4217:BRL`                       — fiat currency
 *   - `stellar:USDC:GBBD47IF...`          — issued Stellar asset
 *   - `stellar:native`                    — XLM
 *
 * Using the SEP-38 identifier as the canonical form (rather than each anchor's
 * private encoding) is what lets the router compare quotes across anchors that
 * otherwise share no vocabulary. Adapters translate to/from it at their edge.
 */

export type AssetId = string;

export interface ParsedAsset {
  scheme: 'iso4217' | 'stellar';
  /** `BRL`, `USDC`, `XLM` */
  code: string;
  /** Stellar issuer `G...`. Absent for fiat and for native XLM. */
  issuer?: string;
}

export function parseAsset(id: AssetId): ParsedAsset {
  const parts = id.split(':');
  const scheme = parts[0];

  if (scheme === 'iso4217') {
    const code = parts[1];
    if (!code) throw new Error(`Malformed fiat asset id: "${id}"`);
    return { scheme: 'iso4217', code };
  }

  if (scheme === 'stellar') {
    if (parts[1] === 'native') return { scheme: 'stellar', code: 'XLM' };
    const code = parts[1];
    const issuer = parts[2];
    if (!code || !issuer) throw new Error(`Malformed Stellar asset id: "${id}"`);
    return { scheme: 'stellar', code, issuer };
  }

  throw new Error(`Unknown asset scheme in "${id}" — expected iso4217: or stellar:`);
}

export function formatAsset(asset: ParsedAsset): AssetId {
  if (asset.scheme === 'iso4217') return `iso4217:${asset.code}`;
  if (asset.code === 'XLM' && !asset.issuer) return 'stellar:native';
  return `stellar:${asset.code}:${asset.issuer}`;
}

export const fiat = (code: string): AssetId => `iso4217:${code.toUpperCase()}`;
export const stellarAsset = (code: string, issuer: string): AssetId => `stellar:${code}:${issuer}`;

export const isFiat = (id: AssetId): boolean => id.startsWith('iso4217:');
export const isStellar = (id: AssetId): boolean => id.startsWith('stellar:');
export const isNative = (id: AssetId): boolean => id === 'stellar:native';

/** Short human label: `BRL`, `USDC`, `XLM`. */
export function assetCode(id: AssetId): string {
  return parseAsset(id).code;
}

/** `USDC` on issuer A and `USDC` on issuer B are different assets. Compare fully. */
export function sameAsset(a: AssetId, b: AssetId): boolean {
  return a === b;
}

// ── Network ───────────────────────────────────────────────────────────────────

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT = 'https://friendbot.stellar.org';

// ── Known regional assets ─────────────────────────────────────────────────────

/**
 * Etherfuse's Brazilian stablebond, the asset their PIX sandbox ramps into.
 * This — not USDC — is what a BRL on-ramp actually delivers on testnet.
 */
export const TESOURO_ISSUER_TESTNET = 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';
export const TESOURO = stellarAsset('TESOURO', TESOURO_ISSUER_TESTNET);

/**
 * Testnet USDC. There are TWO USDC issuers on testnet with NO shared liquidity;
 * picking the wrong one silently produces an unfillable market. We pin Circle's,
 * which is also the issuer served by testanchor.stellar.org (verified against
 * its SEP-38 /info), so anchor quotes and DEX offers refer to the same asset.
 */
export const USDC_ISSUER_TESTNET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC = stellarAsset('USDC', USDC_ISSUER_TESTNET);

/** Transfero's BRL stablecoin — mainnet only, referenced for completeness. */
export const BRZ_ISSUER_MAINNET = 'GABMA6FPH3OJXNTGWO7PROF7I5WPQUZOB4BLTBTP4FK6QV7HWISLIEO2';

export const XLM: AssetId = 'stellar:native';

export const BRL = fiat('BRL');
export const MXN = fiat('MXN');
export const USD = fiat('USD');
export const ARS = fiat('ARS');

// ── Countries ─────────────────────────────────────────────────────────────────

export type CountryCode = 'BR' | 'MX' | 'AR' | 'CL' | 'CO' | 'PE' | 'US';

/** Local payment rail per country — used for UI copy, not for routing logic. */
export const PAYMENT_RAIL: Record<CountryCode, string> = {
  BR: 'PIX',
  MX: 'SPEI',
  AR: 'CBU/CVU',
  CL: 'Transferencia',
  CO: 'PSE',
  PE: 'CCI',
  US: 'ACH/Wire',
};

export const COUNTRY_CURRENCY: Record<CountryCode, AssetId> = {
  BR: BRL,
  MX: MXN,
  AR: ARS,
  CL: fiat('CLP'),
  CO: fiat('COP'),
  PE: fiat('PEN'),
  US: USD,
};
