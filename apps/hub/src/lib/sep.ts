import 'server-only';

/**
 * SEP-10 client wiring for the hub.
 *
 * The verification step runs here, on the server, before the challenge is ever
 * handed to the browser. That ordering matters: `readChallengeTx` is what proves
 * the transaction is a real, unsubmittable SEP-10 challenge from the anchor whose
 * `SIGNING_KEY` the TOML advertises — and not an actual payment a spoofed anchor
 * would love a signature for. By the time the XDR reaches Freighter it has
 * already been checked.
 */

import { Sep10Client } from '@brk/adapter-sep';
import { RampError } from '@brk/ramp-core';
import { readyAnchors } from './anchors';

export async function sep10(): Promise<Sep10Client> {
  const { sep } = await readyAnchors();
  const { toml } = await sep.metadata();

  if (!toml.WEB_AUTH_ENDPOINT || !toml.SIGNING_KEY) {
    throw new RampError({
      code: 'AUTH_FAILED',
      anchorId: 'testanchor',
      message: 'The anchor does not advertise WEB_AUTH_ENDPOINT and SIGNING_KEY — no SEP-10.',
    });
  }

  return new Sep10Client({
    webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
    serverSigningKey: toml.SIGNING_KEY,
    homeDomain: process.env.SEP_ANCHOR_HOME_DOMAIN ?? 'testanchor.stellar.org',
    networkPassphrase: toml.NETWORK_PASSPHRASE,
  });
}
