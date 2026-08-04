/**
 * The mock transport.
 *
 * It exists so a fresh clone with no `.env` can walk the whole flow, which means
 * these tests are also the guarantee that CI's zero-credential smoke run has
 * something to smoke. What they pin hardest is the two places a mock could
 * quietly start lying: a credential must not verify before it is submitted, and
 * a revoked one must not keep reading as valid.
 *
 * Every test uses its own wallet, because the store is pinned to the realm and
 * shared wallets would make the suite order-dependent.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { isValidDid, parseDid } from '../did/did';
import {
  MOCK_XDR_PREFIX,
  MockIdentityApi,
  mockDidFor,
  resetMockIdentity,
  revokeMockVc,
} from './mock';

/** A distinct wallet per test, so nothing in this file depends on order. */
let seed = 0;
const wallet = () => Keypair.fromRawEd25519Seed(Buffer.alloc(32, ++seed % 251)).publicKey();

const api = new MockIdentityApi();

beforeEach(resetMockIdentity);

async function register(controller: string) {
  const prepared = await api.prepareDidRegistration(controller);
  await api.submitDidTx(prepared.xdr);
  return prepared.did!;
}

describe('mode', () => {
  it('says it is a mock, so the badge cannot be wrong', () => {
    expect(api.mode).toBe('mock');
  });
});

describe('mockDidFor', () => {
  it('is stable for a wallet, so a restart does not orphan its attestations', () => {
    const controller = wallet();
    expect(mockDidFor(controller)).toBe(mockDidFor(controller));
  });

  it('differs between wallets', () => {
    expect(mockDidFor(wallet())).not.toBe(mockDidFor(wallet()));
  });

  it('produces a DID the real regex accepts', () => {
    expect(isValidDid(mockDidFor(wallet()))).toBe(true);
  });

  it('honours the network', () => {
    expect(parseDid(mockDidFor(wallet(), 'mainnet'))?.network).toBe('mainnet');
  });

  it('rejects a passkey contract address like the live client does', () => {
    expect(() => mockDidFor('CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')).toThrow(
      /classic account/,
    );
  });
});

describe('DID registration', () => {
  it('hands back a marker, never something a wallet could sign', () => {
    // Mock mode has no transaction. A plausible-looking XDR would send the user
    // to their wallet for a signature over nothing.
    return api.prepareDidRegistration(wallet()).then((prepared) => {
      expect(prepared.xdr.startsWith(MOCK_XDR_PREFIX)).toBe(true);
    });
  });

  it('records the DID with the controller and its key', async () => {
    const controller = wallet();
    const did = await register(controller);

    const record = await api.getDidRecord(did);
    expect(record).toMatchObject({ did, controller, version: 1, deactivated: false });
    expect(record?.authentication[0]).toMatch(/^z6Mk/);
  });

  it('answers null for a DID nobody registered', async () => {
    await expect(api.getDidRecord(mockDidFor(wallet()))).resolves.toBeNull();
  });

  it('refuses to register the same wallet twice', async () => {
    const controller = wallet();
    await register(controller);

    await expect(api.prepareDidRegistration(controller)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_ORDER_STATE' }),
    );
  });

  /*
   * The marker splits on `|`, not `:`. A did:stellar is itself colon-separated,
   * so a colon separator hands back `did` / `stellar` / `testnet` as three
   * fields and every registration fails as malformed — which the first version
   * of this mock did.
   */
  it('survives the colons inside the DID it carries', async () => {
    const controller = wallet();
    const prepared = await api.prepareDidRegistration(controller);

    expect(prepared.did).toContain(':');
    await expect(api.submitDidTx(prepared.xdr)).resolves.toMatchObject({
      txId: expect.stringContaining('mock-tx-'),
    });
  });

  it('rejects a submission that is not a mock registration', async () => {
    await expect(api.submitDidTx('AAAAAgAAreallooking')).rejects.toThrow(/mock register/);
  });

  it('rejects a marker carrying a malformed DID', async () => {
    await expect(api.submitDidTx(`${MOCK_XDR_PREFIX}register|not-a-did|GABC`)).rejects.toThrow(
      /Malformed mock registration/,
    );
  });
});

describe('credentials', () => {
  const owner = 'GISSUER';

  it('does not verify a credential that was only prepared', async () => {
    // Preparing is not issuing. If a prepare that is never signed left a valid
    // credential, every abandoned attempt would grant eligibility.
    await api.prepareVcIssue({
      owner,
      vcId: 'att-a',
      vcData: '{}',
      issuer: owner,
      issuerDid: 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
      sourcePublicKey: owner,
    });

    await expect(api.verifyVc({ owner, vcId: 'att-a' })).resolves.toMatchObject({
      status: 'invalid',
    });
  });

  it('verifies as valid once submitted', async () => {
    const prepared = await api.prepareVcIssue({
      owner,
      vcId: 'att-b',
      vcData: '{}',
      issuer: owner,
      issuerDid: 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
      sourcePublicKey: owner,
    });
    await api.submitVcIssue(prepared.xdr);

    const verified = await api.verifyVc({ owner, vcId: 'att-b' });
    expect(verified.status).toBe('valid');
    expect(verified.since).toBeTruthy();
  });

  it('answers unknown for a credential nobody issued', async () => {
    await expect(api.verifyVc({ owner, vcId: 'att-never' })).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('will not verify another owner`s credential', async () => {
    const prepared = await api.prepareVcIssue({
      owner,
      vcId: 'att-c',
      vcData: '{}',
      issuer: owner,
      issuerDid: 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
      sourcePublicKey: owner,
    });
    await api.submitVcIssue(prepared.xdr);

    await expect(api.verifyVc({ owner: 'GSOMEONEELSE', vcId: 'att-c' })).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('refuses to submit a credential that was never prepared', async () => {
    await expect(api.submitVcIssue(`${MOCK_XDR_PREFIX}issue|att-ghost|${owner}`)).rejects.toThrow(
      /Unknown mock credential/,
    );
  });

  it('rejects a submission that is not a mock issuance', async () => {
    await expect(api.submitVcIssue('AAAAAgAAreallooking')).rejects.toThrow(/mock issue/);
  });

  it('reports a revoked credential as revoked, with a date', async () => {
    const prepared = await api.prepareVcIssue({
      owner,
      vcId: 'att-d',
      vcData: '{}',
      issuer: owner,
      issuerDid: 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
      sourcePublicKey: owner,
    });
    await api.submitVcIssue(prepared.xdr);

    expect(revokeMockVc('att-d', '2026-03-01T00:00:00.000Z')).toBe(true);
    await expect(api.verifyVc({ owner, vcId: 'att-d' })).resolves.toEqual({
      status: 'revoked',
      since: '2026-03-01T00:00:00.000Z',
    });
  });

  it('reports nothing to revoke rather than pretending it worked', () => {
    expect(revokeMockVc('att-never')).toBe(false);
  });
});

describe('resetMockIdentity', () => {
  it('drops everything, so tests cannot leak into each other', async () => {
    const did = await register(wallet());
    expect(await api.getDidRecord(did)).not.toBeNull();

    resetMockIdentity();
    expect(await api.getDidRecord(did)).toBeNull();
  });
});
