import { describe, expect, it } from 'vitest';
import {
  BRL,
  TESOURO,
  USDC,
  USDC_ISSUER_TESTNET,
  assetCode,
  fiat,
  formatAsset,
  isFiat,
  isNative,
  isStellar,
  parseAsset,
  sameAsset,
  stellarAsset,
} from './assets';

describe('SEP-38 asset identifiers', () => {
  it('parses fiat', () => {
    expect(parseAsset(BRL)).toEqual({ scheme: 'iso4217', code: 'BRL' });
  });

  it('parses an issued Stellar asset', () => {
    expect(parseAsset(USDC)).toEqual({
      scheme: 'stellar',
      code: 'USDC',
      issuer: USDC_ISSUER_TESTNET,
    });
  });

  it('parses native', () => {
    expect(parseAsset('stellar:native')).toEqual({ scheme: 'stellar', code: 'XLM' });
  });

  it('round-trips through formatAsset', () => {
    for (const asset of [BRL, USDC, TESOURO, 'stellar:native']) {
      expect(formatAsset(parseAsset(asset))).toBe(asset);
    }
  });

  it('rejects malformed identifiers instead of guessing', () => {
    expect(() => parseAsset('USDC')).toThrow('Unknown asset scheme');
    expect(() => parseAsset('stellar:USDC')).toThrow('Malformed');
    expect(() => parseAsset('iso4217:')).toThrow('Malformed');
  });
});

describe('predicates', () => {
  it('classifies assets', () => {
    expect(isFiat(BRL)).toBe(true);
    expect(isFiat(USDC)).toBe(false);
    expect(isStellar(USDC)).toBe(true);
    expect(isNative('stellar:native')).toBe(true);
    expect(isNative(USDC)).toBe(false);
  });

  it('extracts a display code', () => {
    expect(assetCode(BRL)).toBe('BRL');
    expect(assetCode(TESOURO)).toBe('TESOURO');
    expect(assetCode('stellar:native')).toBe('XLM');
  });
});

describe('issuer identity', () => {
  /**
   * Testnet has two USDC issuers with no shared liquidity. Comparing on code
   * alone is how you end up with a market that can never fill.
   */
  it('treats the same code from different issuers as different assets', () => {
    const other = stellarAsset('USDC', 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56');
    expect(assetCode(other)).toBe(assetCode(USDC));
    expect(sameAsset(other, USDC)).toBe(false);
  });

  it('pins USDC to Circle’s testnet issuer', () => {
    expect(USDC).toBe(`stellar:USDC:${USDC_ISSUER_TESTNET}`);
    expect(USDC_ISSUER_TESTNET).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });
});

describe('helpers', () => {
  it('uppercases fiat codes', () => {
    expect(fiat('brl')).toBe('iso4217:BRL');
  });
});
