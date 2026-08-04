'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Whether we are past hydration and `document` is safe to portal into.
 *
 * `useSyncExternalStore` answers this without writing state from an effect:
 * the server snapshot is `false`, the client snapshot is `true`, and React
 * reconciles the difference itself. Setting a `mounted` flag inside an effect
 * does the same job by scheduling a second render, which is exactly the
 * cascading-render pattern this project's lint rules reject.
 *
 * The store never changes, so `subscribe` has nothing to do.
 */
const noop = () => () => {};
const useIsClient = () =>
  React.useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

function Portal({ className, ...props }: React.ComponentProps<'div'>) {
  const isClient = useIsClient();

  // Lock the page behind the overlay, and compensate for the scrollbar the
  // lock removes so the layout underneath does not jump sideways.
  React.useEffect(() => {
    if (!isClient) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isClient]);

  if (!isClient) return null;

  return createPortal(
    <div className={cn('fixed inset-0 isolate z-40 flex flex-col', className)} {...props} />,
    document.body,
  );
}

function PortalBackdrop({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'fixed inset-0 -z-1 bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60',
        className,
      )}
      {...props}
    />
  );
}

export { Portal, PortalBackdrop };
