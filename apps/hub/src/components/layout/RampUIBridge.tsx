'use client';

import { RampUIProvider } from '@brk/ramp-ui';
import { useI18n } from '@/client/i18n';

/**
 * Feeds the hub's dictionary into the component package.
 *
 * The package renders English on its own, which is what makes it droppable
 * into someone else's app with a single import. Here it is handed the hub's
 * three-locale dictionary instead, so the reference app consumes the package
 * exactly the way a Brazilian or Mexican integrator would: install, wrap, pass
 * your own `t`.
 */
export function RampUIBridge({ children }: { children: React.ReactNode }) {
  const { t, tag } = useI18n();
  return (
    <RampUIProvider t={t} locale={tag}>
      {children}
    </RampUIProvider>
  );
}
