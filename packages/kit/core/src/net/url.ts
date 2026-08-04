/**
 * URL tidying that cannot be turned into a denial of service.
 *
 * Every anchor endpoint in this kit gets its trailing slashes trimmed before a
 * path is appended, because a TOML that says `https://anchor.test/sep38/` and
 * one that says `https://anchor.test/sep38` have to behave the same.
 *
 * The obvious way to write that is `value.replace(/\/+$/, '')`, and it is a
 * polynomial ReDoS. `\/+$` has to try every start position, and at each one it
 * matches a run of slashes and then backtracks through it looking for the end
 * of the string — so a value with n slashes that are not at the end costs
 * O(n²). Measured on Node 24: 10k slashes took 28ms, 80k took 1.8s. Doubling
 * the input quadruples the time.
 *
 * That matters because these strings are not ours. `TRANSFER_SERVER_SEP0024`,
 * `ANCHOR_QUOTE_SERVER` and `WEB_AUTH_ENDPOINT` all come from a third party's
 * `stellar.toml`, and the router fetches those from anchors it does not
 * control. A hostile or compromised anchor could publish a long run of slashes
 * and block the server's event loop — which in a Next app stalls every other
 * request, not just the one that fetched the TOML.
 *
 * A single backwards scan does the same job in linear time with no backtracking.
 */

const SLASH = 47; // '/'

/** Remove any trailing `/` characters. Linear time, no regex backtracking. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end--;
  // Avoid allocating a copy when there was nothing to trim, which is the
  // overwhelmingly common case.
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Strip a leading `http://` or `https://` and any trailing slashes, leaving a
 * bare host — what SEP-1 and SEP-10 mean by a "home domain".
 *
 * The scheme is matched with a bounded prefix check rather than a regex for the
 * same reason as above: nothing here should scale worse than linearly in the
 * length of a string an anchor chose.
 */
export function toHomeDomain(value: string): string {
  let out = value;
  if (out.startsWith('https://')) out = out.slice(8);
  else if (out.startsWith('http://')) out = out.slice(7);
  return stripTrailingSlashes(out);
}
