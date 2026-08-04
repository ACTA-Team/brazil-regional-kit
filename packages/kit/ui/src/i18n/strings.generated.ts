/*
 * Built-in English strings.
 *
 * Generated from the hub's dictionary so the package's defaults cannot drift
 * from the sentences the reference app actually ships. A consumer that passes
 * its own `t` to <RampUIProvider> never reads this file; a consumer that drops
 * the components in with no configuration sees exactly these.
 */
export const DEFAULT_STRINGS: Record<string, string> = {
  'common.amount': 'Amount',
  'common.back': 'Back',
  'common.copied': 'Copied',
  'common.copy': 'Copy',
  'common.expired': 'Expired',
  'common.expiresIn': 'Expires in {seconds}s',
  'common.fee': 'Fee',
  'common.loading': 'Loading…',
  'common.rate': 'Rate',
  'common.retry': 'Retry',
  'common.youReceive': 'You receive',
  'common.youSend': 'You send',
  'corridor.memoCounter': '{bytes}/{max} bytes',
  'corridor.memoLabel': 'Message for the recipient',
  'corridor.memoTooLong': 'Too long. Accented characters take more than one byte.',
  'mode.live': 'live',
  'mode.liveHint': "Talking to the anchor's real sandbox.",
  'mode.mock': 'simulated',
  'mode.mockHint': 'Replaying recorded fixtures. No network call to the anchor.',
  'onramp.beneficiary': 'Beneficiary',
  'onramp.depositHint':
    'Transfer this amount using the rail below. The anchor releases the asset once it lands.',
  'onramp.depositTitle': 'Send the payment',
  'onramp.pixHint': 'Open your bank app, choose PIX copia e cola, and paste the code below.',
  'onramp.pixTitle': 'Pay this PIX',
  'onramp.rail': 'Rail',
  'onramp.reference': 'Reference',
  'onramp.sandboxNoReference':
    'The sandbox names the rail but does not issue a payable reference. There is nothing real to transfer to. Use the button below to tell the anchor the payment arrived, which is exactly what its sandbox settlement hook is for.',
  'onramp.simulateHint': 'Sandbox only: tells Etherfuse the PIX was paid.',
  'onramp.simulatePayment': 'Simulate PIX payment',
  'stepper.offramp.action': 'Sign the return transaction',
  'stepper.offramp.completed': 'BRL sent via PIX',
  'stepper.offramp.created': 'Order created',
  'stepper.offramp.processing': 'Anchor is paying out',
  'stepper.onramp.action': 'Waiting for the PIX payment',
  'stepper.onramp.completed': 'Asset delivered on-chain',
  'stepper.onramp.created': 'Order created',
  'stepper.onramp.processing': 'Anchor is settling',
};
