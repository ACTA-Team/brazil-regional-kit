import { cn } from '@/lib/utils';

/**
 * The kit's mark.
 *
 * Typography, not a drawn logo: a monospace monogram on a verde→amarelo chip,
 * next to the wordmark. This is the one filled gold surface allowed outside a
 * primary action, and it gets away with it because it is 30px square and half
 * green — it reads as a mark, not as something to click.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('flex shrink-0 items-center gap-3 whitespace-nowrap', className)}>
      <span
        aria-hidden="true"
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] font-mono text-[11px] tracking-[0.04em] text-black"
        style={{
          background: 'linear-gradient(135deg, oklch(0.72 0.17 152), oklch(0.88 0.16 96))',
        }}
      >
        BR
      </span>
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Brazil Regional Kit</span>
      ) : null}
    </span>
  );
}
