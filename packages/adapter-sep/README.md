# @brk/adapter-sep

A ramp adapter for **any** SEP-compliant Stellar anchor. Point it at a home
domain; everything else is discovered.

```bash
pnpm add @brk/adapter-sep @brk/ramp-core @stellar/stellar-sdk
```

## Use

```ts
import { createSepAdapter } from '@brk/adapter-sep';

const anchor = createSepAdapter({
  mode: 'live',
  homeDomain: 'testanchor.stellar.org', // the default
  defaultCountry: 'US',
});

await anchor.discover();            // reads stellar.toml + SEP-38 /info once
anchor.capabilities().corridors;    // derived from what the anchor advertises

const quote = await anchor.getQuote({ sellAsset: USDC, buyAsset: USD, sellAmount: '100' });
```

## SEP-38 needs no credentials

The useful discovery behind this package: `/info`, `/prices` and `/price` are
**unauthenticated**. A client can show live, real quotes from any SEP-38 anchor
before the user has signed anything, created an account, or completed KYC —
which is exactly what a multi-anchor router needs.

Only `POST /quote` (a firm, reservable quote) requires a SEP-10 JWT.

## SEP-10, done safely

The anchor hands you a transaction and asks you to sign it. That is a dangerous
shape: a spoofed anchor would love a signature on a real payment. SEP-10 defends
against it with invariants — sequence 0 so it can never be submitted, the
anchor's own `SIGNING_KEY` as source, a `manage_data` operation naming the
expected domain.

**This package verifies all of them, and refuses to hand an unverified challenge
to a wallet.**

```ts
import { Sep10Client } from '@brk/adapter-sep';

const client = new Sep10Client({
  webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
  serverSigningKey: toml.SIGNING_KEY,
  homeDomain: 'testanchor.stellar.org',
});

const jwt = await client.authenticate(address, (xdr, passphrase) =>
  signWithWallet(xdr, passphrase),
);
```

`sign` is injected, so it works with Freighter in a browser and with a raw
keypair in a script or test.

## Also exported

```ts
import { fetchStellarToml, parseStellarToml, Sep38Client, decodeJwtClaims } from '@brk/adapter-sep';
```

The TOML reader is dependency-free — SEP-1 exists so a client can bootstrap an
anchor from nothing but its domain, and carrying a general-purpose TOML parser
to read fifteen keys would be the wrong trade.
