'use client';

import { useId } from 'react';

const PRESETS = ['100', '250', '500', '1000'];

/**
 * Amount input.
 *
 * Accepts a comma as the decimal separator because that is what a Brazilian
 * keyboard produces, and normalizes it to a dot before the value ever reaches
 * an anchor — `"1,50"` silently parsed as `1` is a real way to lose money.
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
      <label htmlFor={id} className="block text-sm text-ink-300">
        {label}
      </label>

      <div className="relative mt-2">
        {suffix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
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
          className="field text-lg tabular-nums"
          style={suffix ? { paddingLeft: '2.5rem' } : undefined}
        />
      </div>

      {presets.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                value === p
                  ? 'border-brand-600 bg-brand-700/25 text-brand-200'
                  : 'border-border-subtle text-ink-400 hover:text-ink-100'
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
