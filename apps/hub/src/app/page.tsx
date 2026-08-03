'use client';

import Link from 'next/link';
import { PAYMENT_RAIL, assetCode, BRL, MXN, TESOURO, USDC } from '@brk/ramp-core';
import { useI18n } from '@/lib/i18n';

/** The demo's spine, in the order a judge should click through it. */
const STEPS = [
  {
    href: '/onramp',
    titleKey: 'onramp.title',
    bodyKey: 'onramp.subtitle',
    from: assetCode(BRL),
    to: assetCode(TESOURO),
    rail: PAYMENT_RAIL.BR,
  },
  {
    href: '/router',
    titleKey: 'router.title',
    bodyKey: 'router.subtitle',
    from: assetCode(BRL),
    to: assetCode(USDC),
    rail: '4 anchors',
  },
  {
    href: '/corridor',
    titleKey: 'corridor.title',
    bodyKey: 'corridor.subtitle',
    from: assetCode(USDC),
    to: assetCode(MXN),
    rail: PAYMENT_RAIL.MX,
  },
  {
    href: '/offramp',
    titleKey: 'offramp.title',
    bodyKey: 'offramp.subtitle',
    from: assetCode(TESOURO),
    to: assetCode(BRL),
    rail: PAYMENT_RAIL.BR,
  },
] as const;

export default function HomePage() {
  const { t } = useI18n();

  return (
    <div className="space-y-10">
      <section className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">
          Stellar · Brazil &amp; LATAM
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {t('home.title')}
        </h1>
        <p className="mt-4 max-w-2xl text-ink-300">{t('home.subtitle')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/onramp" className="btn btn-primary">
            {t('home.cta.start')}
          </Link>
          <a href="https://github.com" className="btn btn-ghost" target="_blank" rel="noreferrer">
            {t('home.cta.docs')}
          </a>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <Link
            key={step.href}
            href={step.href}
            className="card group flex flex-col gap-3 p-5 transition-colors hover:border-brand-600"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-inset text-xs font-semibold text-ink-400">
                {i + 1}
              </span>
              <h2 className="font-semibold">{t(step.titleKey)}</h2>
            </div>
            <p className="text-sm leading-relaxed text-ink-400">{t(step.bodyKey)}</p>
            <div className="mt-auto flex items-center gap-2 pt-2 font-mono text-xs text-ink-500">
              <span className="rounded bg-surface-inset px-1.5 py-0.5">{step.from}</span>
              <span aria-hidden="true" className="text-brand-400">
                →
              </span>
              <span className="rounded bg-surface-inset px-1.5 py-0.5">{step.to}</span>
              <span className="ml-auto">{step.rail}</span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
