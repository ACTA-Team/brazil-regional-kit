'use client';

/**
 * Every glyph in the app, from one family, at one weight.
 *
 * Routing icons through a single module is what keeps them consistent: one
 * import site to change if the family changes, one place where the weight is
 * decided, and no way for a stray emoji or a hand-drawn SVG path to creep back
 * in. Emoji render differently on every platform and carry no semantics for a
 * screen reader, so they are not an option for UI meaning.
 */
import {
  ArrowRight,
  ArrowUUpLeft,
  ArrowsLeftRight,
  Bank,
  Check,
  CircleNotch,
  Coins,
  Info,
  List,
  Money,
  PaperPlaneTilt,
  Warning,
  Wallet,
  X,
  type Icon,
} from '@phosphor-icons/react';

export type { Icon };

export {
  ArrowRight,
  ArrowUUpLeft,
  ArrowsLeftRight,
  Bank,
  Check,
  CircleNotch,
  Coins,
  Info,
  List,
  Money,
  PaperPlaneTilt,
  Warning,
  Wallet,
  X,
};

/**
 * Standard weight for UI glyphs. `bold` reads correctly at the 12–16px sizes
 * this interface uses; `regular` goes muddy against the dark canvas.
 */
export const ICON_WEIGHT = 'bold' as const;

/** Busy indicator. Inherits the current text colour, so it works in any button. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <CircleNotch
      size={14}
      weight={ICON_WEIGHT}
      className={`animate-spin ${className}`}
      aria-hidden="true"
    />
  );
}
