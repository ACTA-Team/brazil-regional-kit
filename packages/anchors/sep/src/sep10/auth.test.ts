/**
 * SEP-10 is the one place in the kit where a wallet is asked to sign something
 * an anchor chose. Everything here is about the refusal direction: a challenge
 * that cannot be proven safe must never reach `sign`.
 *
 * The challenges are built with the real SDK and real keypairs rather than
 * hand-written XDR, so these tests exercise actual signature verification. Only
 * `fetch` is faked — the anchor is the external dependency, the verification is
 * the thing under test.
 */

import { describe, expect, it, vi } from 'vitest';
import { Keypair, Networks, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { Sep10Client, decodeJwtClaims } from './auth';

const HOME_DOMAIN = 'anchor.test';
const WEB_AUTH_ENDPOINT = 'https://auth.anchor.test/auth';
const WEB_AUTH_DOMAIN = 'auth.anchor.test';

const anchorKey = Keypair.random();
const clientKey = Keypair.random();

function challengeXdr(
  options: {
    signer?: Keypair;
    account?: string;
    homeDomain?: string;
    webAuthDomain?: string;
  } = {},
): string {
  return WebAuth.buildChallengeTx(
    options.signer ?? anchorKey,
    options.account ?? clientKey.publicKey(),
    options.homeDomain ?? HOME_DOMAIN,
    300,
    Networks.TESTNET,
    options.webAuthDomain ?? WEB_AUTH_DOMAIN,
  );
}

/** A `fetch` that answers every call with one canned response. */
function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string'
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch, overrides: Partial<{ serverSigningKey: string }> = {}) {
  return new Sep10Client({
    webAuthEndpoint: WEB_AUTH_ENDPOINT,
    serverSigningKey: overrides.serverSigningKey ?? anchorKey.publicKey(),
    homeDomain: HOME_DOMAIN,
    networkPassphrase: Networks.TESTNET,
    fetchImpl,
  });
}

describe('challenge verification', () => {
  it('accepts a challenge the anchor genuinely signed', async () => {
    const result = await client(fetchReturning({ transaction: challengeXdr() })).challenge(
      clientKey.publicKey(),
    );

    expect(result.clientAccountId).toBe(clientKey.publicKey());
    expect(result.networkPassphrase).toBe(Networks.TESTNET);
    expect(result.transaction).toBeTruthy();
  });

  /**
   * The attack SEP-10 exists to stop: somebody else's transaction presented as
   * this anchor's challenge. If the signature is not the advertised SIGNING_KEY,
   * signing it could authorize anything.
   */
  it('refuses a challenge signed by a key that is not the anchor’s SIGNING_KEY', async () => {
    const impostor = Keypair.random();

    await expect(
      client(fetchReturning({ transaction: challengeXdr({ signer: impostor }) })).challenge(
        clientKey.publicKey(),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('refuses a challenge naming a different home domain', async () => {
    await expect(
      client(fetchReturning({ transaction: challengeXdr({ homeDomain: 'evil.test' }) })).challenge(
        clientKey.publicKey(),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  /** web-auth domain is the host of the auth endpoint, not the home domain. */
  it('refuses a challenge naming a different web-auth domain', async () => {
    await expect(
      client(
        fetchReturning({ transaction: challengeXdr({ webAuthDomain: 'auth.evil.test' }) }),
      ).challenge(clientKey.publicKey()),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  /**
   * A challenge issued for somebody else's account is not ours to sign — and if
   * it were signed, the JWT would be minted for the wrong subject.
   */
  it('refuses a challenge issued for a different account', async () => {
    const other = Keypair.random();

    await expect(
      client(
        fetchReturning({ transaction: challengeXdr({ account: other.publicKey() }) }),
      ).challenge(clientKey.publicKey()),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('refuses a challenge signed for the wrong network', async () => {
    const wrongNetwork = WebAuth.buildChallengeTx(
      anchorKey,
      clientKey.publicKey(),
      HOME_DOMAIN,
      300,
      Networks.PUBLIC,
      WEB_AUTH_DOMAIN,
    );

    await expect(
      client(
        fetchReturning({ transaction: wrongNetwork, network_passphrase: Networks.TESTNET }),
      ).challenge(clientKey.publicKey()),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('surfaces the anchor’s own reason when it returns no challenge', async () => {
    await expect(
      client(fetchReturning({ error: 'account is banned' })).challenge(clientKey.publicKey()),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'account is banned' });
  });

  it('reports a missing challenge even when the anchor explains nothing', async () => {
    await expect(client(fetchReturning({})).challenge(clientKey.publicKey())).rejects.toMatchObject(
      { code: 'AUTH_FAILED' },
    );
  });

  it('asks for the account and home domain the caller configured', async () => {
    const fetchImpl = fetchReturning({ transaction: challengeXdr() });
    await client(fetchImpl).challenge(clientKey.publicKey(), 'wallet.example');

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0]![0] as string);
    expect(url.searchParams.get('account')).toBe(clientKey.publicKey());
    expect(url.searchParams.get('home_domain')).toBe(HOME_DOMAIN);
    expect(url.searchParams.get('client_domain')).toBe('wallet.example');
  });

  it('omits client_domain when the caller did not supply one', async () => {
    const fetchImpl = fetchReturning({ transaction: challengeXdr() });
    await client(fetchImpl).challenge(clientKey.publicKey());

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0]![0] as string);
    expect(url.searchParams.has('client_domain')).toBe(false);
  });
});

describe('option normalization', () => {
  it('tolerates a trailing slash on the auth endpoint', async () => {
    const fetchImpl = fetchReturning({ transaction: challengeXdr() });
    const sep10 = new Sep10Client({
      webAuthEndpoint: `${WEB_AUTH_ENDPOINT}///`,
      serverSigningKey: anchorKey.publicKey(),
      homeDomain: HOME_DOMAIN,
      networkPassphrase: Networks.TESTNET,
      fetchImpl,
    });

    await sep10.challenge(clientKey.publicKey());
    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toContain(`${WEB_AUTH_ENDPOINT}?`);
  });

  /**
   * TOMLs in the wild write the home domain with a scheme. Passing that through
   * would make every challenge fail verification against a correct anchor.
   */
  it('strips a scheme and trailing slash from the home domain', async () => {
    const fetchImpl = fetchReturning({ transaction: challengeXdr() });
    const sep10 = new Sep10Client({
      webAuthEndpoint: WEB_AUTH_ENDPOINT,
      serverSigningKey: anchorKey.publicKey(),
      homeDomain: `https://${HOME_DOMAIN}/`,
      networkPassphrase: Networks.TESTNET,
      fetchImpl,
    });

    await expect(sep10.challenge(clientKey.publicKey())).resolves.toMatchObject({
      clientAccountId: clientKey.publicKey(),
    });
  });
});

describe('token exchange', () => {
  it('returns the JWT the anchor issued', async () => {
    await expect(
      client(fetchReturning({ token: 'jwt.value.here' })).token('signed-xdr'),
    ).resolves.toBe('jwt.value.here');
  });

  it('POSTs the signed transaction as JSON', async () => {
    const fetchImpl = fetchReturning({ token: 'x' });
    await client(fetchImpl).token('signed-xdr');

    const init = vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ transaction: 'signed-xdr' });
  });

  it('fails loudly rather than returning an empty token', async () => {
    await expect(client(fetchReturning({})).token('signed-xdr')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  it('surfaces the anchor’s rejection reason', async () => {
    await expect(
      client(fetchReturning({ error: 'signature does not meet threshold' })).token('signed-xdr'),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'signature does not meet threshold' });
  });
});

describe('transport failures', () => {
  it('maps a 401 with no body to AUTH_FAILED, not a generic outage', async () => {
    await expect(client(fetchReturning('', 401)).token('x')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      status: 401,
    });
  });

  it('maps a 502 to ANCHOR_UNAVAILABLE so the router can skip the anchor', async () => {
    await expect(client(fetchReturning('', 502)).token('x')).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
      status: 502,
    });
  });

  it('normalizes a thrown network error instead of leaking it', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(client(boom).challenge(clientKey.publicKey())).rejects.toMatchObject({
      code: 'ANCHOR_UNAVAILABLE',
    });
  });

  it('treats an unparseable body as a failure rather than an empty success', async () => {
    await expect(
      client(fetchReturning('<html>gateway timeout</html>', 200)).token('x'),
    ).rejects.toMatchObject({ code: 'ANCHOR_UNAVAILABLE' });
  });
});

describe('full handshake', () => {
  it('signs the verified challenge and exchanges it for a token', async () => {
    const xdr = challengeXdr();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ token: 'final.jwt' }))
        : new Response(JSON.stringify({ transaction: xdr })),
    ) as unknown as typeof fetch;

    const signed: string[] = [];
    const token = await client(fetchImpl).authenticate(
      clientKey.publicKey(),
      async (toSign, net) => {
        signed.push(net);
        const tx = TransactionBuilder.fromXDR(toSign, net);
        tx.sign(clientKey);
        return tx.toXDR();
      },
    );

    expect(token).toBe('final.jwt');
    expect(signed).toEqual([Networks.TESTNET]);
  });

  it('never calls the signer when verification fails', async () => {
    const impostor = Keypair.random();
    const sign = vi.fn();

    await expect(
      client(fetchReturning({ transaction: challengeXdr({ signer: impostor }) })).authenticate(
        clientKey.publicKey(),
        sign,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    expect(sign).not.toHaveBeenCalled();
  });
});

describe('decodeJwtClaims', () => {
  const encode = (claims: Record<string, unknown>) =>
    `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

  it('reads the claims of a well-formed token', () => {
    expect(decodeJwtClaims(encode({ sub: 'GABC', exp: 123 }))).toEqual({ sub: 'GABC', exp: 123 });
  });

  it('handles base64url padding characters', () => {
    const claims = { sub: 'GABC', scope: 'a+b/c??' };
    expect(decodeJwtClaims(encode(claims))).toEqual(claims);
  });

  it('returns null for a string that is not a JWT', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
  });

  it('returns null rather than throwing on a corrupt payload', () => {
    expect(decodeJwtClaims('header.!!!not-base64!!!.sig')).toBeNull();
  });

  it('returns null when the payload decodes but is not JSON', () => {
    expect(
      decodeJwtClaims(`header.${Buffer.from('plain text').toString('base64url')}.sig`),
    ).toBeNull();
  });
});
