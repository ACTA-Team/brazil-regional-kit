import { cn } from '@/lib/utils';

/**
 * The kit's mark.
 *
 * Typography, not a drawn logo: a monospace monogram in a gold-outlined square,
 * next to the wordmark. Outlined rather than filled on purpose. A solid gold
 * badge in the header would spend the one accent the manual allows per screen
 * on branding, leaving the actual primary action with nothing to stand out
 * against.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-success/60 bg-success/12 font-mono text-[11px] font-medium text-gold"
      >
        BR
      </span>
      {showWordmark ? (
        <span className="text-sm font-bold tracking-tight">Brazil Regional Kit</span>
      ) : null}
    </span>
  );
}
