/**
 * @brk/ramp-router — one API, many anchors.
 *
 * Register any set of `RampAdapter`s and ask a single question; the router fans
 * out in parallel, ranks what comes back, and reports what every anchor did —
 * including the ones that could not help.
 */

export * from './router';
