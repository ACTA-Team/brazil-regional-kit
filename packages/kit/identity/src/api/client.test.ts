/**
 * The live ACTA client.
 *
 * `fetch` is injected, so nothing here reaches did.acta.build or the credentials
 * API. What these tests pin is the contract we depend on: which host each call
 * goes to, that the API key never leaks onto an unauthenticated resolver
 * request, and that ACTA's documented error codes land on the kit's taxonomy —
 * because every layer above branches on those codes and none of them on text.
 */

import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  ACTA_MAINNET_API_URL,
  ACTA_TESTNET_API_URL,
  ActaIdentityClient,
  DID_RESOLVER_URL,
  ENDPOINTS,
} from './client';

const API_KEY = 'test-acta-key';
const DID = 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi';
const CONTROLLER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string'
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

const client = (fetchImpl: typeof fetch, opts: Record<string, unknown> = {}) =>
  new ActaIdentityClient({ apiKey: API_KEY, fetchImpl, ...opts });

const urlOf = (fetchImpl: typeof fetch, call = 0) =>
  String(vi.mocked(fetchImpl).mock.calls[call]![0]);
const initOf = (fetchImpl: typeof fetch, call = 0) =>
  vi.mocked(fetchImpl).mock.calls[call]![1] as RequestInit;
const bodyOf = (fetchImpl: typeof fetch, call = 0) =>
  JSON.parse(String(initOf(fetchImpl, call).body)) as Record<string, unknown>;

const PREPARED = { xdr: 'AAAAAgAA', networkPassphrase: 'Test SDF Network ; September 2015' };

describe('routing and credentials', () => {
  it('reports itself as the live transport', () => {
    expect(new ActaIdentityClient().mode).toBe('live');
  });

  it('sends DID work to the resolver and credential work to the API', async () => {
    const resolver = fetchReturning(PREPARED);
    await client(resolver).prepareDidRegistration(CONTROLLER);
    expect(urlOf(resolver)).toBe(`${DID_RESOLVER_URL}${ENDPOINTS.didRegister}`);

    const api = fetchReturning({ status: 'valid' });
    await client(api).verifyVc({ owner: CONTROLLER, vcId: 'att-x' });
    expect(urlOf(api)).toBe(`${ACTA_TESTNET_API_URL}${ENDPOINTS.vcVerify}`);
  });

  /*
   * The resolver is deliberately unauthenticated. Attaching the key anyway would
   * hand a credential to a service that never asked for one — a small leak, but
   * a real one, and free to avoid.
   */
  it('does not send the API key to the resolver', async () => {
    const fetchImpl = fetchReturning(PREPARED);
    await client(fetchImpl).prepareDidRegistration(CONTROLLER);

    expect(initOf(fetchImpl).headers).not.toHaveProperty('X-ACTA-Key');
  });

  it('sends the API key to the credentials API', async () => {
    const fetchImpl = fetchReturning({ status: 'valid' });
    await client(fetchImpl).verifyVc({ owner: CONTROLLER, vcId: 'att-x' });

    expect((initOf(fetchImpl).headers as Record<string, string>)['X-ACTA-Key']).toBe(API_KEY);
  });

  it('fails before the request when a credential call has no key', async () => {
    // A missing key is a configuration problem. Finding out from a 401 tells
    // you less and costs a round trip.
    const fetchImpl = fetchReturning({});
    await expect(
      new ActaIdentityClient({ fetchImpl }).verifyVc({ owner: CONTROLLER, vcId: 'att-x' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'AUTH_FAILED' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names the env var to set', async () => {
    await expect(
      new ActaIdentityClient({ fetchImpl: fetchReturning({}) }).verifyVc({
        owner: CONTROLLER,
        vcId: 'att-x',
      }),
    ).rejects.toThrow(/ACTA_API_KEY/);
  });

  it('resolves without a key, because resolution is public', async () => {
    const fetchImpl = fetchReturning({ record: { controller: CONTROLLER, version: 1 } });
    await expect(new ActaIdentityClient({ fetchImpl }).getDidRecord(DID)).resolves.toMatchObject({
      controller: CONTROLLER,
    });
  });

  it('honours custom hosts and trims trailing slashes', async () => {
    const fetchImpl = fetchReturning(PREPARED);
    await client(fetchImpl, { resolverUrl: 'https://did.example.com//' }).prepareDidRegistration(
      CONTROLLER,
    );

    expect(urlOf(fetchImpl)).toBe(`https://did.example.com${ENDPOINTS.didRegister}`);
  });

  it('targets mainnet hosts and mints mainnet DIDs when asked', async () => {
    const resolver = fetchReturning(PREPARED);
    const prepared = await client(resolver, { network: 'mainnet' }).prepareDidRegistration(
      CONTROLLER,
    );
    expect(prepared.did?.startsWith('did:stellar:mainnet:')).toBe(true);

    // The network picks the credentials host too — a testnet key pointed at the
    // mainnet API is an auth failure that reads like a broken integration.
    const api = fetchReturning({ status: 'valid' });
    await client(api, { network: 'mainnet' }).verifyVc({ owner: CONTROLLER, vcId: 'att-x' });
    expect(urlOf(api)).toBe(`${ACTA_MAINNET_API_URL}${ENDPOINTS.vcVerify}`);
  });
});

describe('prepareDidRegistration', () => {
  it('mints the DID locally rather than waiting for the response to echo it', async () => {
    // The prepare response is not documented to carry the DID. Depending on it
    // would make registration fail on a service change we cannot see coming.
    const fetchImpl = fetchReturning({ xdr: 'AAAA', networkPassphrase: 'Test' });
    const prepared = await client(fetchImpl).prepareDidRegistration(CONTROLLER);

    expect(prepared.did).toMatch(/^did:stellar:testnet:[a-z2-7]{26}$/);
    expect(bodyOf(fetchImpl).did).toBe(prepared.did);
  });

  it('puts the controller key in both authentication and assertionMethod', async () => {
    // An issuer without an assertion key cannot sign credentials, and W3C
    // verifiers reject what it does sign. Same key in both is the idiomatic shape.
    const fetchImpl = fetchReturning(PREPARED);
    await client(fetchImpl).prepareDidRegistration(CONTROLLER);

    const record = bodyOf(fetchImpl).record as {
      controller: string;
      authentication: Array<{ publicKeyMultibase: string }>;
      assertionMethod: Array<{ publicKeyMultibase: string }>;
    };
    expect(record.controller).toBe(CONTROLLER);
    expect(record.authentication[0]!.publicKeyMultibase).toMatch(/^z6Mk/);
    expect(record.assertionMethod[0]!.publicKeyMultibase).toBe(
      record.authentication[0]!.publicKeyMultibase,
    );
  });

  it('rejects a passkey contract address before any network call', async () => {
    const fetchImpl = fetchReturning(PREPARED);
    await expect(
      client(fetchImpl).prepareDidRegistration(
        'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
      ),
    ).rejects.toThrow(/classic account/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a response with no XDR as the service being broken', async () => {
    await expect(
      client(fetchReturning({ networkPassphrase: 'Test' })).prepareDidRegistration(CONTROLLER),
    ).rejects.toThrow(expect.objectContaining({ code: 'ANCHOR_UNAVAILABLE' }));
  });

  it('accepts `network` as an alias for the passphrase', async () => {
    // The resolver says `networkPassphrase`; the credentials API says `network`.
    // Both carry the same string, and a wallet cannot sign without it.
    const prepared = await client(
      fetchReturning({ xdr: 'AAAA', network: 'Test SDF Network ; September 2015' }),
    ).prepareVcIssue({
      owner: CONTROLLER,
      vcId: 'att-x',
      vcData: '{}',
      issuer: CONTROLLER,
      issuerDid: DID,
      sourcePublicKey: CONTROLLER,
    });

    expect(prepared.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });
});

describe('getDidRecord', () => {
  it('flattens the record to what a verifier needs', async () => {
    const fetchImpl = fetchReturning({
      did: DID,
      record: {
        controller: CONTROLLER,
        authentication: [{ publicKeyMultibase: 'z6MkAAA' }, { publicKeyMultibase: 'z6MkBBB' }],
        version: 3,
        deactivated: false,
      },
    });

    await expect(client(fetchImpl).getDidRecord(DID)).resolves.toEqual({
      did: DID,
      controller: CONTROLLER,
      authentication: ['z6MkAAA', 'z6MkBBB'],
      version: 3,
      deactivated: false,
    });
    expect(urlOf(fetchImpl)).toBe(`${DID_RESOLVER_URL}${ENDPOINTS.didRecord(DID)}`);
  });

  /*
   * "This DID is not registered" is an answer, not a failure — the identity page
   * asks it on every load. Throwing would turn a normal state into an error banner.
   */
  it('answers null for an unregistered DID', async () => {
    await expect(
      client(fetchReturning({ code: 'did_not_found' }, 404)).getDidRecord(DID),
    ).resolves.toBeNull();
  });

  it('answers null when the payload carries no record', async () => {
    await expect(client(fetchReturning({ did: DID })).getDidRecord(DID)).resolves.toBeNull();
  });

  it('drops keys with no multibase value instead of emitting undefined', async () => {
    const record = await client(
      fetchReturning({ record: { controller: CONTROLLER, authentication: [{}] } }),
    ).getDidRecord(DID);

    expect(record?.authentication).toEqual([]);
  });

  it('surfaces a deactivated DID rather than hiding the tombstone', async () => {
    const record = await client(
      fetchReturning({ record: { controller: CONTROLLER, version: 4, deactivated: true } }),
    ).getDidRecord(DID);

    expect(record?.deactivated).toBe(true);
  });
});

describe('credential operations', () => {
  it('sends the issue payload untouched', async () => {
    const fetchImpl = fetchReturning(PREPARED);
    const req = {
      owner: CONTROLLER,
      vcId: 'att-etherfuse-abc',
      vcData: '{"a":1}',
      issuer: CONTROLLER,
      issuerDid: DID,
      sourcePublicKey: CONTROLLER,
    };
    await client(fetchImpl).prepareVcIssue(req);

    expect(urlOf(fetchImpl)).toBe(`${ACTA_TESTNET_API_URL}${ENDPOINTS.vcIssue}`);
    expect(bodyOf(fetchImpl)).toEqual(req);
  });

  it('submits to the same endpoint with only the signed XDR', async () => {
    const fetchImpl = fetchReturning({ tx_id: 'abc123' });
    await expect(client(fetchImpl).submitVcIssue('SIGNED')).resolves.toEqual({ txId: 'abc123' });

    expect(bodyOf(fetchImpl)).toEqual({ signedXdr: 'SIGNED' });
  });

  it('reads the resolver`s camelCase txId too', async () => {
    await expect(client(fetchReturning({ txId: 'def456' })).submitDidTx('SIGNED')).resolves.toEqual(
      { txId: 'def456' },
    );
  });

  it.each(['valid', 'revoked', 'invalid'] as const)('passes through status %s', async (status) => {
    await expect(
      client(fetchReturning({ status, since: '2026-01-01T00:00:00.000Z' })).verifyVc({
        owner: CONTROLLER,
        vcId: 'att-x',
      }),
    ).resolves.toEqual({ status, since: '2026-01-01T00:00:00.000Z' });
  });

  it('maps an unrecognised status to unknown rather than trusting it', async () => {
    await expect(
      client(fetchReturning({ status: 'probably-fine' })).verifyVc({
        owner: CONTROLLER,
        vcId: 'att-x',
      }),
    ).resolves.toEqual({ status: 'unknown', since: undefined });
  });

  it('treats a missing credential as unknown, not as an error', async () => {
    // Not yet attested is the normal state for most users on most anchors.
    await expect(
      client(fetchReturning({}, 404)).verifyVc({ owner: CONTROLLER, vcId: 'att-x' }),
    ).resolves.toEqual({ status: 'unknown' });
  });
});

describe('error mapping', () => {
  const failing = (body: unknown, status: number) =>
    client(fetchReturning(body, status)).verifyVc({ owner: CONTROLLER, vcId: 'att-x' });

  it.each([
    ['did_invalid', 'INVALID_REQUEST'],
    ['did_already_exists', 'INVALID_ORDER_STATE'],
    ['did_deactivated', 'INVALID_ORDER_STATE'],
    ['version_mismatch', 'INVALID_ORDER_STATE'],
    ['issuerDid_controller_mismatch', 'INVALID_REQUEST'],
    ['rate_limited', 'ANCHOR_UNAVAILABLE'],
    ['tx_submission_failed', 'ANCHOR_UNAVAILABLE'],
  ])('maps %s to %s', async (code, expected) => {
    await expect(failing({ code, message: 'nope' }, 400)).rejects.toThrow(
      expect.objectContaining({ code: expected, anchorId: 'acta' }),
    );
  });

  it('reads the credentials API `error` field as well as `code`', async () => {
    await expect(
      failing({ error: 'issuerDid_controller_mismatch', message: 'mismatch' }, 400),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it.each([
    [401, 'AUTH_FAILED'],
    [403, 'AUTH_FAILED'],
    [409, 'INVALID_ORDER_STATE'],
    [410, 'INVALID_ORDER_STATE'],
    [429, 'ANCHOR_UNAVAILABLE'],
    [500, 'ANCHOR_UNAVAILABLE'],
    [503, 'ANCHOR_UNAVAILABLE'],
    [400, 'INVALID_REQUEST'],
  ])('falls back to the status when there is no code: %i → %s', async (status, expected) => {
    await expect(failing({ message: 'boom' }, status)).rejects.toThrow(
      expect.objectContaining({ code: expected, status }),
    );
  });

  it('marks a rate limit retryable, so callers can back off rather than give up', async () => {
    await expect(failing({ code: 'rate_limited' }, 429)).rejects.toThrow(
      expect.objectContaining({ retryable: true }),
    );
  });

  it('survives a non-JSON error body', async () => {
    await expect(failing('<html>gateway timeout</html>', 502)).rejects.toThrow(
      expect.objectContaining({ code: 'ANCHOR_UNAVAILABLE' }),
    );
  });

  it('keeps the ACTA message so the cause is readable', async () => {
    await expect(failing({ code: 'did_invalid', message: 'bad did syntax' }, 400)).rejects.toThrow(
      /bad did syntax/,
    );
  });

  it('falls back to the code when there is no message', async () => {
    await expect(failing({ code: 'did_invalid' }, 400)).rejects.toThrow(/did_invalid/);
  });

  it('reports an unreachable host as the service being down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(client(fetchImpl).verifyVc({ owner: CONTROLLER, vcId: 'att-x' })).rejects.toThrow(
      expect.objectContaining({ code: 'ANCHOR_UNAVAILABLE' }),
    );
  });

  it('aborts a hanging request instead of holding the page open', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    await expect(
      client(fetchImpl, { timeoutMs: 5 }).verifyVc({ owner: CONTROLLER, vcId: 'att-x' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ANCHOR_UNAVAILABLE' }));
  });
});
