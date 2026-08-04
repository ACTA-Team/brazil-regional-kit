/**
 * Drop-in React components for Stellar ramp flows.
 *
 * These are the screens every ramp integration ends up rebuilding: entering an
 * amount, reading a quote before accepting it, watching an order move, paying
 * by PIX or bank transfer, and writing a memo that will not be truncated by the
 * network. Each one already knows the regional traps — comma decimals, the
 * 28-byte memo limit measured in bytes, quotes that expire in seconds, the
 * difference between a live anchor and a replayed fixture.
 *
 * They render readable English with no configuration. Wrap them in
 * `<RampUIProvider t={...} locale="pt-BR">` and they speak your dictionary.
 *
 * ```tsx
 * import { QuoteCard, RampUIProvider } from '@brk/ramp-ui';
 * import '@brk/ramp-ui/styles.css';
 * ```
 */

export { RampUIProvider, useRampUI, formatMoney, formatToken, type Translate } from './i18n';
export { DEFAULT_STRINGS } from './strings.generated';

export { Alert } from './Alert';
export { AmountField } from './AmountField';
export { ExpiryPill, useCountdown } from './Countdown';
export { DepositPanel } from './DepositPanel';
export { MemoField } from './MemoField';
export { ModeBadge } from './ModeBadge';
export { OrderStepper } from './OrderStepper';
export { PixPanel } from './PixPanel';
export { QuoteCard, Spinner, displayAmount, type PublicQuote } from './QuoteCard';

export { ICON_WEIGHT } from './icons';
