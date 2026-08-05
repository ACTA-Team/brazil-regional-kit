# Identity

One API, many anchors — and one identity.

The router answers "who is cheapest". Until now nothing answered "and can I take
that price". Onboarding is per anchor, so the honest answer differs per row of
the quote table, and a user who does not know it finds out from a failed payment.

`@brk/identity-kit` is the layer that closes the gap: a `did:stellar` per user,
an onboarding attestation per anchor, and an eligibility annotation the router
page renders as a chip.

## What this is not

**It is not portable KYC.** No anchor accepts another anchor's checks. KYC/AML
obligations attach to the institution, not to the customer, and a credential
cannot transfer them — Etherfuse cannot lawfully treat Anclap's diligence as its
own, and neither can anyone else.

What an attestation removes is the blind re-discovery. The kit knows which
anchors a DID has already onboarded with, so the router can mark the rows that
are executable instead of offering four prices of which one works. The anchor
still runs its own KYC, every time.

The disclaimer travels inside the credential, not only in this file:

```json
"credentialSubject": {
  "id": "did:stellar:testnet:…",
  "anchorId": "etherfuse",
  "attestation": "onboarding-completed",
  "disclaimer": "The anchor performs its own KYC. This attests that onboarding
    with this anchor was completed for this DID; it is not transferable KYC and
    no other anchor should treat it as such."
}
```

## did:stellar in one minute

A [W3C DID](https://www.w3.org/TR/did-1.1/) method built by ACTA on Stellar. The
state lives in a Soroban registry contract, so a DID is valid if and only if it
is on-chain — the hosted resolver at `did.acta.build` is a convenience, not a
gatekeeper, and anyone can resolve a DID with nothing but an RPC URL.

```
did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi
            ^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^
            network 16 random bytes, base32 lowercase
```

Three properties the code depends on:

- **The identifier is opaque.** It is not derived from any account, which is
  what lets a DID survive key rotation and lets one wallet control several.
- **The controller is a classic `G…` account.** Every mutation needs its
  signature — `controller.require_auth()` in the contract. Passkey wallets
  expose a `C…` contract address, which has no Ed25519 key and is rejected with
  an explanation rather than a validation error.
- **Reads are free.** Resolution is a ledger-entry read, no transaction.

### The key is your wallet's key

`prepareDidRegistration` takes the controller's `G…` address, decodes it to the
32 raw Ed25519 bytes underneath, and re-encodes them as the `z6Mk…` multikey the
registry stores — in `authentication` and `assertionMethod` both, which is the
shape an issuer needs.

A strkey and a multikey are the same key material in different clothes. Because
of that there is no second key to generate, store or lose, and proof of control
needs only the wallet the user already has.

## The flow

```mermaid
sequenceDiagram
  participant U as User
  participant H as Hub
  participant R as did.acta.build
  participant A as ACTA credentials

  U->>H: connect wallet
  H->>R: prepare registration (DID minted locally)
  R-->>H: unsigned XDR
  H->>H: sanity-check it
  H-->>U: sign this
  U->>H: signed
  H->>R: submit
  Note over U,R: the user controls the DID; the hub never holds a key for it

  U->>H: attest me for Etherfuse
  H->>A: issue VC (hub signs as issuer)
  Note over H,A: subject = user's DID, vault = hub's own

  U->>H: GET /api/quotes?…&did=…
  H->>A: verify-vc (cached 60s)
  H-->>U: quotes, each marked eligible / needs onboarding
```

## Eligibility

`annotateEligibility` runs in `/api/quotes`, not in the router. `@brk/ramp-router`
does not import identity, its public API is unchanged, and a request without a
`did` gets exactly the response it got before this existed.

| Status | Meaning | Chip |
|---|---|---|
| `eligible` | A valid attestation exists for this DID and anchor | verde |
| `needs-onboarding` | None, or one that was revoked | gold, links to `/identity` |
| `not-required` | The anchor does not gate execution on onboarding | none |
| `no-did` | No DID was supplied | none |
| `unknown` | We asked and could not get an answer | none |

Only the first two earn a chip. `not-required` would sit on most rows and become
wallpaper; `no-did` and `unknown` are statements about us, not about the user.
Not knowing looks like not knowing.

**Identity can never break quoting.** `annotateEligibility` does not reject —
whatever fails inside it degrades that anchor to `unknown` — and the route wraps
it anyway. Prices are the product.

### The credential id is derived, not stored

```
att-<anchorId>-<didId>      e.g. att-etherfuse-znfxngsh46vkyqu6inrx4omphi
```

Anyone holding the DID can recompute it, so answering "is this DID attested for
Etherfuse?" needs no index, no database and no lookup table — just a
`verify-vc`. It also makes issuance idempotent: attesting twice is the same
credential, and the second attempt reports `alreadyIssued` after confirming with
the vault.

Anchor ids are capped at 33 characters by that format. Over it, `attestationVcId`
throws rather than truncating — a trimmed id would silently collide, and one
anchor's attestation would grant eligibility on another's.

### Whose vault

Attestations live in the **hub's** vault, not the user's. ACTA binds a non-admin
API key to one wallet and requires the vault `owner` to be that wallet; issuing
into per-user vaults would mean deploying a vault per user and holding an admin
key. The subject is still the user's DID, so the credential is about them either
way, and `verify-vc` is open to any API key so third parties can check it.

### Caching

60 seconds, keyed by `(mode, did, anchorId)`. The router page re-quotes every 15,
an open-ended route asks one anchor about several assets, and the upstream
resolver allows 120 requests a minute. Mode is part of the key so that adding an
API key and restarting does not serve mocked answers until the TTL expires.

## Proof of control

DID login, with no password and no transaction. The verifier issues a challenge,
the holder signs it, the verifier checks the signature against the keys in the
document it resolves *itself* — never against keys the caller supplies.

The checks run in a deliberate order:

1. **Freshness** — five-minute window.
2. **Domain** — the challenge names this site, so a signature collected
   elsewhere cannot be replayed here.
3. **Nonce** — single use, and **burned before the signature is checked**. A
   nonce that survived a failed attempt would let an attacker retry a captured
   signature until something changed, which is not single use.
4. **Signature** — last, because the three cheap checks above eliminate the
   cases where verifying the cryptography would tell you nothing.

The signed bytes are the challenge canonicalized with JCS (RFC 8785), so both
sides sign the same thing regardless of how their JSON serializer orders keys.

**Not every wallet can sign a message.** It is a separate capability from
signing a transaction, and the wallets that have it disagree about what exactly
they sign — some hash first, some prepend a prefix. `signMessageWithWallet`
returns `null` for a wallet that cannot, so the panel says so in a sentence
instead of showing a wallet-internal string.

## Where the DID lives

**Nowhere we can look it up.** The registry is keyed by DID, so there is no
controller→DID reverse lookup — not in the resolver, not here, not anywhere. One
wallet may control several DIDs and the contract does not index the other
direction.

So the browser caches it in `localStorage` under `brk.identity.did`, and that
cache is treated as a cache:

- On every wallet change the remembered DID is resolved and kept **only if the
  connected wallet is still its controller**. Otherwise the router would
  annotate quotes with whoever last used this browser — showing one person's
  onboarding to another, which is worse than showing nothing.
- Cleared storage, a different machine or a different browser means the DID has
  to be pasted back in. The paste box is not a convenience; it is the only route
  back, and the paste is verified the same way.

## What the hub checks before you sign

The resolver hands back a transaction and asks for a signature. This kit already
distrusts that shape once — `Sep10Client.challenge()` verifies an anchor's
challenge before a wallet sees it — and `assertSignableRegistration` applies the
same reflex:

**Checked:** it parses; the network passphrase is testnet; the source account is
the connected wallet; the fee is under 10 XLM.

**Not checked:** what the Soroban invocation actually does. Verifying that would
mean reimplementing the registry contract's argument encoding, and a wrong
reimplementation would reject valid registrations while still not proving much.
The honest position is that the resolver is trusted for the call's contents and
verified for everything around them — and that a controller can always walk away
from a DID they do not like.

## Configuration

Everything is optional. With no configuration the layer runs in a **labelled
mock**: the whole flow works, nothing reaches a chain or a credential vault, and
`GET /api/identity/status` says `mock`. CI runs exactly that state.

| Variable | Effect |
|---|---|
| `IDENTITY_MODE` | `live` \| `mock`. Falls back to `RAMP_MODE`, then `mock` |
| `ACTA_API_KEY` | Credentials API key. Bound to one wallet |
| `ACTA_API_URL` | Defaults to `https://api.testnet.acta.build` |
| `DID_RESOLVER_URL` | Defaults to `https://did.acta.build` |
| `IDENTITY_ISSUER_SECRET` | Signs issuance. **Server-side only, testnet only** |
| `IDENTITY_ISSUER_DID` | The hub's own registered DID |

`live` needs all three of the last two plus the key. A half-configured layer
degrades to mock rather than failing at the first click.

```bash
pnpm setup:identity
```

Creates the issuer account, funds it with friendbot, registers its DID and
prints the two values to save. **Run it once.** Every attestation the hub has
ever signed points at that DID; minting a new one does not migrate them, it
orphans them. The script refuses a second run without `--force`.

Issuance costs **5 XLM per credential** on testnet, paid by the issuer, so keep
that account funded before a demo.

## Mock mode, precisely

Two departures from the live services, both visible rather than hidden:

- **The DID is derived from the wallet, not random.** The real method mints 16
  random bytes precisely so the DID is not tied to an account; the mock uses the
  first 16 bytes of the controller's key so a restart gives you the same DID
  back instead of orphaning the attestations you just made.
- **Nothing is signed.** `prepare` returns a marker string (`mock-xdr:…`), not
  an XDR. There is no transaction, so there is nothing for a wallet to sign and
  nothing lands on-chain. The UI skips the signature prompt rather than asking
  for a signature over a string that means nothing.

Proof of control in mock mode uses a documented deterministic stand-in, prefixed
`mock-poc:` so nothing can mistake it for a signature. It still has to pass the
window, domain and nonce checks.

## Reading more

- [`packages/kit/identity`](../packages/kit/identity) — the package
- [ACTA docs](https://docs.acta.build/en/did-overview) — the method, the
  registry contract and the credentials API
- [`docs/protocols.md`](./protocols.md) — SEP-10, whose verify-before-you-sign
  posture this borrows
