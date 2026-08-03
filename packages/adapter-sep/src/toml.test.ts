import { describe, expect, it } from 'vitest';
import { parseStellarToml } from './toml';

/** Trimmed from the real testanchor.stellar.org TOML. */
const SAMPLE = `
ACCOUNTS = ["GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE"]
VERSION = "0.1.0"
SIGNING_KEY = "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

# A comment that must be ignored
WEB_AUTH_ENDPOINT = "https://testanchor.stellar.org/auth"
TRANSFER_SERVER_SEP0024 = "https://testanchor.stellar.org/sep24"
ANCHOR_QUOTE_SERVER = "https://testanchor.stellar.org/sep38"

[[CURRENCIES]]
code = "SRT"
issuer = "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B"
status = "test"
is_asset_anchored = false

[[CURRENCIES]]
code = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
status = "test"

[DOCUMENTATION]
ORG_NAME = "Stellar Development Foundation"
`;

describe('stellar.toml parsing', () => {
  const toml = parseStellarToml(SAMPLE);

  it('reads the scalars a client needs to bootstrap', () => {
    expect(toml.VERSION).toBe('0.1.0');
    expect(toml.SIGNING_KEY).toBe('GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR');
    expect(toml.ANCHOR_QUOTE_SERVER).toBe('https://testanchor.stellar.org/sep38');
    expect(toml.WEB_AUTH_ENDPOINT).toBe('https://testanchor.stellar.org/auth');
  });

  it('keeps a passphrase containing a semicolon intact', () => {
    expect(toml.NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
  });

  it('reads string arrays', () => {
    expect(toml.ACCOUNTS).toEqual(['GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE']);
  });

  it('collects [[ARRAY]] sections in order', () => {
    expect(toml.CURRENCIES).toHaveLength(2);
    expect(toml.CURRENCIES?.[0]?.code).toBe('SRT');
    expect(toml.CURRENCIES?.[1]?.code).toBe('USDC');
    expect(toml.CURRENCIES?.[1]?.issuer).toBe(
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    );
  });

  it('coerces booleans', () => {
    expect(toml.CURRENCIES?.[0]?.is_asset_anchored).toBe(false);
  });

  it('reads [TABLE] sections without swallowing later keys', () => {
    expect((toml.DOCUMENTATION as Record<string, unknown>)?.ORG_NAME).toBe(
      'Stellar Development Foundation',
    );
  });

  it('ignores comments and blank lines', () => {
    expect(Object.keys(toml)).not.toContain('#');
  });

  it('survives an empty document', () => {
    expect(parseStellarToml('')).toEqual({});
  });

  it('does not strip a # that lives inside a quoted value', () => {
    const parsed = parseStellarToml('DESC = "colour #1 anchor"');
    expect(parsed.DESC).toBe('colour #1 anchor');
  });
});
