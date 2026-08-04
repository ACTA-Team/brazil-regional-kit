'use client';

import Link from 'next/link';
import { PAYMENT_RAIL, assetCode, BRL, MXN, TESOURO, USDC } from '@brk/ramp-core';
import { ArrowRight, ICON_WEIGHT } from '@/components/icons';
import { useI18n } from '@/client/i18n';

/** The demo's spine, in the order it should be clicked through. */
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

export function OverviewPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-14">
      {/* ── Hero ──────────────────────────────────────────────────────────
          One small label, one headline, one subtitle, one primary action.
          Nothing else competes for the first screen. */}
      <section className="animate-rise pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-success">
          Stellar · Brazil &amp; LATAM
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.1] sm:text-5xl">
          {t('home.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fg-muted">{t('home.subtitle')}</p>

        {/* Exactly one gold action on this screen, per the manual. */}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/onramp" className="btn btn-primary btn-lg">
            {t('home.cta.start')}
            <ArrowRight size={16} weight={ICON_WEIGHT} aria-hidden="true" />
          </Link>
          <a
            href="https://github.com/ACTA-Team/brazil-regional-kit"
            className="btn btn-outline btn-lg"
            target="_blank"
            rel="noreferrer"
          >
            {t('home.cta.docs')}
          </a>
        </div>
      </section>

      {/* ── The journey ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold">{t('home.journey')}</h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <Link
              key={step.href}
              href={step.href}
              className="card card-hover animate-rise group flex flex-col gap-3 p-5"
              // Tailwind cannot see a class built from a template literal, so the
              // entrance stagger is an inline delay rather than a utility.
              style={{ animationDelay: `${(i + 1) * 70}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-success/50 bg-success/10 font-mono text-xs text-success transition-colors group-hover:border-success group-hover:bg-success/20">
                  {i + 1}
                </span>
                <h3 className="font-bold">{t(step.titleKey)}</h3>
              </div>

              <p className="text-sm leading-relaxed text-fg-muted">{t(step.bodyKey)}</p>

              <div className="mt-auto flex items-center gap-2 pt-2 font-mono text-xs">
                <span className="well px-1.5 py-0.5 text-fg-muted">{step.from}</span>
                <ArrowRight
                  size={12}
                  weight={ICON_WEIGHT}
                  aria-hidden="true"
                  className="text-success/70 transition-colors group-hover:text-success"
                />
                <span className="well px-1.5 py-0.5 text-fg-muted">{step.to}</span>
                <span className="ml-auto text-fg-subtle">{step.rail}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────────────────────
          "Verification is public and on-chain." These are claims a visitor can
          check for themselves, so they belong on the landing page rather than
          buried in a README. Hairlines separate them; no cards needed. */}
      <section className="card animate-rise grid gap-px overflow-hidden bg-line sm:grid-cols-3">
        {[
          { value: '2', labelKey: 'home.trust.anchors' },
          { value: 'testnet', labelKey: 'home.trust.network' },
          { value: 'MIT', labelKey: 'home.trust.license' },
        ].map((item) => (
          <div key={item.labelKey} className="bg-surface px-5 py-4">
            <p className="font-mono text-xl font-medium text-success">{item.value}</p>
            <p className="mt-1 text-xs text-fg-muted">{t(item.labelKey)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
