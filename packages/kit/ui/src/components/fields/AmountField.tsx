'use client';

import { useId } from 'react';

const PRESETS = ['100', '250', '500', '1000'];

/**
 * Amount input.
 *
 * Accepts a comma as the decimal separator because that is what a Brazilian
 * keyboard produces, and normalizes it to a dot before the value ever reaches
 * an anchor — `"1,50"` silently parsed as `1` is a real way to lose money.
 *
 * The amount is the largest text on the screen. It is the one number the user
 * is actually deciding about, and making them hunt for it in body copy is how
 * a form starts to feel like paperwork.
 */
export function AmountField({
  label,
  value,
  onChange,
  suffix,
  presets = PRESETS,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  currency?: string;
  suffix?: string;
  presets?: string[];
}) {
  const id = useId();

  const handle = (raw: string) => {
    const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '');
    // Keep at most one decimal point.
    const [whole, ...rest] = normalized.split('.');
    onChange(rest.length ? `${whole}.${rest.join('')}` : normalized);
  };

  return (
    <div>
      <label htmlFor={id} className="label block">
        {label}
      </label>

      <div className="relative mt-2.5">
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xl font-medium text-fg-subtle">
            {suffix}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => handle(e.target.value)}
          className="field figure py-4 text-3xl"
          style={suffix ? { paddingLeft: '3rem' } : undefined}
        />
      </div>

      {presets.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={value === p}
              // Presets are the same pill the rest of the app uses for a short
              // machine-readable value, so they read as chips, not as buttons
              // competing with the form's one gold action.
              className={`chip tabular-nums transition-colors ${
                value === p ? 'chip-gold' : 'chip-neutral hover:border-white/24 hover:text-fg'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
