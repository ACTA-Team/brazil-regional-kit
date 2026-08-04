/**
 * `@brk/identity-kit` — did:stellar identity for ramps.
 *
 * One API, many anchors, one identity. The router tells you who has the best
 * price; this tells you which of those prices you can actually take.
 *
 * It is entirely optional: nothing in `@brk/ramp-core` or `@brk/ramp-router`
 * imports it, and an app that never installs it behaves exactly as before.
 */

export type { DidNetwork, ParsedDid } from './did/did';
export {
  buildDid,
  decodeMultikey,
  DID_ID_BYTES,
  DID_ID_LENGTH,
  DID_STELLAR_REGEX,
  encodeDidId,
  encodeMultikey,
  generateDidId,
  isTestnetDid,
  isValidDid,
  parseDid,
} from './did/did';

export {
  assertClassicAddress,
  multikeyToWalletKey,
  verifyWithMultikey,
  walletKeyToMultikey,
} from './keys/stellar-key';

export type {
  DidRecord,
  DidRecordInput,
  IdentityApi,
  IdentityMode,
  PreparedTx,
  VcIssueRequest,
  VcStatus,
} from './api/api';
export type { IdentityApiOptions } from './api/create';
export { createIdentityApi } from './api/create';
export type { IdentityClientOptions } from './api/client';
export {
  ACTA_MAINNET_API_URL,
  ACTA_TESTNET_API_URL,
  ActaIdentityClient,
  DID_RESOLVER_URL,
  ENDPOINTS,
  IDENTITY_ANCHOR_ID,
} from './api/client';
export {
  MOCK_XDR_PREFIX,
  MockIdentityApi,
  mockDidFor,
  resetMockIdentity,
  revokeMockVc,
} from './api/mock';

export type {
  AttestationInput,
  AttestationIssuer,
  IssueAttestationRequest,
  IssueAttestationResult,
} from './attestation';
export {
  ANCHOR_ID_MAX_LENGTH,
  ATTESTATION_DISCLAIMER,
  ATTESTATION_TYPE,
  attestationVcId,
  buildAttestationVc,
  issueAttestation,
  VC_CONTEXT_V2,
  VC_DATA_MAX_LENGTH,
  VC_ID_MAX_LENGTH,
} from './attestation';

export type {
  AnchorEligibility,
  AnnotateEligibilityOptions,
  EligibilityInput,
  EligibilityStatus,
} from './eligibility';
export {
  annotateEligibility,
  DEFAULT_ELIGIBILITY_TTL_MS,
  resetEligibilityCache,
} from './eligibility';

export type {
  CreateChallengeRequest,
  PocChallenge,
  PocFailure,
  PocResult,
  VerifyPocRequest,
} from './poc';
export {
  createPocChallenge,
  generateNonce,
  jcsCanonicalize,
  MOCK_SIGNATURE_PREFIX,
  mockPocSignature,
  POC_WINDOW_MS,
  pocMessageBytes,
  resetPocNonces,
  verifyPocResponse,
} from './poc';
