# @brk/identity-kit

**did:stellar identity for ramps.** One API, many anchors — and one identity.

The router tells you who is cheapest. This tells you which of those prices you
can actually take.

```bash
pnpm add @brk/identity-kit
```

Peer dependency: `@stellar/stellar-sdk >= 16` (the host app owns the version).

## What problem it solves

A multi-anchor router returns quotes from every anchor that serves a corridor.
Some of those quotes the user cannot execute, because onboarding is per anchor —
and nothing on screen says which. They find out from a failed payment.

Give a user a `did:stellar`, attest it per anchor, and the quote table can mark
the rows that are executable.

**This is not portable KYC.** No anchor accepts another's checks — the
obligation is per institution and a credential cannot transfer it. What this
removes is the guesswork. The disclaimer travels inside every credential it
issues, not just in the docs.

## Annotate a set of quotes

```ts
import { annotateEligibility, createIdentityApi } from '@brk/identity-kit';

const api = createIdentityApi({ apiKey: process.env.ACTA_API_KEY, mode: 'live' });

const annotated = await annotateEligibility(quotes, {
  api,
  did: 'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
  issuerPublicKey: HUB_WALLET,
  anchors: adapters.map((a) => ({
    anchorId: a.capabilities().id,
    requiresOnboarding: a.capabilities().features.orders,
  })),
});

// each quote gains:
//   eligibility: { status: 'eligible' | 'needs-onboarding' | 'not-required'
//                        | 'no-did' | 'unknown', mode, vcId?, reason?, checkedAt }
```

**It never rejects.** A dead resolver, an expired key or a rate limit degrades
that anchor to `unknown`. Whatever identity does, the caller keeps their prices.

Answers are cached 60 seconds per `(mode, did, anchorId)` — the mode is in the
key so switching to live does not serve mocked answers.

## Register a DID

The controller's own wallet key becomes the DID's verification key: a `G…`
strkey and a `z6Mk…` multikey are the same 32 Ed25519 bytes. No second key to
generate, store or lose.

```ts
const prepared = await api.prepareDidRegistration(walletAddress);
const signed = await wallet.sign(prepared.xdr);
await api.submitDidTx(signed);
// prepared.did is minted locally, not read back from the response
```

## Attest

```ts
import { issueAttestation } from '@brk/identity-kit';

const { vcId, alreadyIssued } = await issueAttestation(api, {
  subjectDid: userDid,
  anchorId: 'etherfuse',
  issuer: { publicKey: HUB_WALLET, did: HUB_DID },
  signXdr: async (prepared) => signServerSide(prepared),
});
```

The credential id is derived — `att-<anchorId>-<didId>` — so eligibility needs
no index and attesting twice is the same credential.

## Prove control

```ts
import { createPocChallenge, verifyPocResponse } from '@brk/identity-kit';

const challenge = createPocChallenge({ did, domain: 'yourapp.com' });
// …the holder signs jcsCanonicalize(challenge) with an authentication key…

const { verified, reason } = verifyPocResponse({
  challenge,
  signature,
  authentication: (await api.getDidRecord(did))!.authentication,
  expectedDomain: 'yourapp.com',
  mode: api.mode,
});
```

Five-minute window, domain binding, single-use nonces burned *before* the
signature is checked, then Ed25519 against every authentication key in the
resolved document.

## Mock mode

`createIdentityApi()` with no key gives a labelled mock: the whole flow works,
nothing reaches a chain. The DID is derived from the wallet so restarts do not
orphan attestations, and `prepare` returns a marker rather than a signable XDR
because there is no transaction to sign.

Every response carries `mode`, so a simulated answer can be badged as one.

## Testing

No network, no credentials, no globals to reset between suites — every client
takes an injected `fetchImpl`, and the two `globalThis` stores expose
`resetMockIdentity()`, `resetEligibilityCache()` and `resetPocNonces()`.

---

Full write-up, including the regulatory framing and what the hub verifies before
a wallet signs: [`docs/identity.md`](../../../docs/identity.md).
