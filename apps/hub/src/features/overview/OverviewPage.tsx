'use client';

import Link from 'next/link';
import { PAYMENT_RAIL, assetCode, BRL, MXN, TESOURO, USDC } from '@brk/ramp-core';
import { ArrowRight, ICON_WEIGHT } from '@/components/icons';
import { CristoLayers } from '@/components/layout/CristoLayers';
import { Reveal } from '@/components/layout/Reveal';
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

/** Page gutter, shared by every band so their left edges line up down the page. */
const GUTTER = 'mx-auto w-full max-w-[1560px] px-6 sm:px-10 lg:px-14';

/**
 * The connector between two corridor legs, with value visibly moving through it.
 *
 * A dashed stroke whose offset animates, rather than a dot travelling along a
 * static rule: the corridor is one continuous path and it should read as one.
 * The gradient carries the same two lights as the legs it joins, so the line
 * says which hop it is as well as that something is moving.
 */
function FlowLine({ from, to }: { from: string; to: string }) {
  const id = `flow-${from}-${to}`.replace(/[^a-z0-9-]/gi, '');
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="2"
      viewBox="0 0 32 2"
      className="shrink-0 overflow-visible"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      {/* The rail, always visible so the corridor never looks broken. */}
      <line x1="0" y1="1" x2="32" y2="1" stroke={`url(#${id})`} strokeWidth="1" opacity="0.35" />
      {/* The moving part. `flow` is the one keyframe here that animates a
          stroke rather than a transform, which is why it can travel along a
          path instead of across a box. */}
      <line
        x1="0"
        y1="1"
        x2="32"
        y2="1"
        stroke={`url(#${id})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="6 26"
        style={{ animation: 'flow 2.4s linear infinite' }}
      />
    </svg>
  );
}

export function OverviewPage() {
  const { t } = useI18n();

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────────────
          One label, one headline, one primary action, and the Cristo dissolving
          away as you scroll off it. Nothing else competes for the first screen.

          auto-fit rather than a breakpoint: below ~840px the statue wraps under
          the copy on its own, with no media query to keep in sync. */}
      <section
        className={`${GUTTER} grid items-center gap-14 pt-[70px] pb-12`}
        style={{
          minHeight: 'calc(100vh - 76px)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <div className="animate-rise z-1 flex max-w-[660px] flex-col items-start gap-6">
          <p className="flex items-center gap-3 font-mono text-xs tracking-[0.18em] text-verde">
            <span aria-hidden="true" className="inline-block h-px w-6.5 bg-verde" />
            {t('home.eyebrow')}
          </p>

          <h1 className="text-[clamp(38px,4.6vw,68px)] leading-none font-semibold tracking-[-0.04em]">
            {t('home.titleLead')} <span className="text-spectrum">{t('home.titleAccent')}</span>
          </h1>

          {/* Exactly one gold action on this screen. */}
          <div className="flex flex-wrap gap-3.5">
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

          <p
            aria-hidden="true"
            className="mt-5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.16em] text-fg-subtle"
          >
            SCROLL
            <span
              className="h-9.5 w-px"
              style={{
                background: 'linear-gradient(to bottom, rgba(237,237,237,0.35), transparent)',
              }}
            />
          </p>
        </div>

        <CristoLayers />
      </section>

      {/* ── The claim ────────────────────────────────────────────────────
          The subtitle, given a whole band to itself at display size. It is the
          one sentence a visitor has to read, so it is not a caption under the
          headline — it is the next thing that happens. */}
      <section className={`${GUTTER} pt-30 pb-10`}>
        <Reveal
          as="p"
          className="max-w-[900px] text-[clamp(22px,2.6vw,34px)] leading-[1.35] font-medium tracking-[-0.025em] text-fg"
        >
          {t('home.subtitle')}
        </Reveal>

        <Reveal className="mt-12 flex flex-wrap gap-x-9 gap-y-4 border-t border-line pt-6.5 font-mono text-xs text-fg-subtle">
          <span>PIX · 24/7</span>
          <span>SEP-6 / SEP-31</span>
          <span>{t('home.meta.anchors')}</span>
          <span>x402</span>
        </Reveal>
      </section>

      {/* ── The journey ──────────────────────────────────────────────────── */}
      <section className={`${GUTTER} pt-6 pb-28`}>
        <Reveal className="mb-8 flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">{t('home.journey')}</h2>
          <span className="font-mono text-xs text-fg-subtle">01 — 04</span>
        </Reveal>

        <div
          className="grid gap-4.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
        >
          {STEPS.map((step, i) => (
            // The stagger is a transition delay rather than a utility class:
            // Tailwind cannot see a class built from a template literal.
            <Reveal key={step.href} delay={i * 90} className="h-full">
              <Link
                href={step.href}
                className="card card-glow card-hover group flex h-full flex-col gap-3.5 p-6.5"
              >
                <div className="relative flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-verde/50 bg-verde/15 font-mono text-[11px] text-verde">
                    {i + 1}
                  </span>
                  <h3 className="text-base font-semibold tracking-[-0.01em]">{t(step.titleKey)}</h3>
                </div>

                <p className="relative text-sm leading-relaxed text-fg-muted">{t(step.bodyKey)}</p>

                <div className="relative mt-auto flex items-center gap-2 pt-5.5 font-mono text-[11px] text-fg-subtle">
                  <span className="well px-2 py-1">{step.from}</span>
                  <ArrowRight
                    size={12}
                    weight={ICON_WEIGHT}
                    aria-hidden="true"
                    className="text-verde"
                  />
                  <span className="well px-2 py-1">{step.to}</span>
                  <span className="ml-auto">{step.rail}</span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── The corridor ─────────────────────────────────────────────────
          A closing band, not a control: Pão de Açúcar in halftone behind the
          one line that says what the whole kit is for. Everything in here is
          decorative and `pointer-events-none`, so it can never intercept a
          click meant for the footer. */}
      <section className="relative min-h-[560px] overflow-hidden border-t border-line">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[58%]">
          {/* Three masks intersected: a soft oval, and a fade in from each
              axis — so the photograph has no edges anywhere, only falloff. */}
          <img
            src="/landmarks/pao-dots.png"
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{
              objectPosition: '50% 40%',
              opacity: 0.72,
              maskImage:
                'radial-gradient(75% 75% at 55% 45%, #000 30%, transparent 92%), linear-gradient(to right, transparent 0%, #000 14%, #000 80%, transparent 100%), linear-gradient(to bottom, transparent 0%, #000 12%, #000 78%, transparent 100%)',
              WebkitMaskImage:
                'radial-gradient(75% 75% at 55% 45%, #000 30%, transparent 92%), linear-gradient(to right, transparent 0%, #000 14%, #000 80%, transparent 100%), linear-gradient(to bottom, transparent 0%, #000 12%, #000 78%, transparent 100%)',
              maskComposite: 'intersect',
              WebkitMaskComposite: 'source-in',
            }}
          />
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, #000 1%, transparent 30%, transparent 70%, #000 99%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 100% at 50% 100%, oklch(0.42 0.13 262 / 0.22), transparent 70%)',
            filter: 'blur(50px)',
          }}
        />

        <div
          className={`${GUTTER} pointer-events-none relative flex min-h-[560px] flex-col items-start justify-end gap-4.5 pb-14`}
        >
          <p className="font-mono text-xs tracking-[0.2em] text-fg-muted uppercase">
            {t('home.corridorLabel')} · BRL → USDC → LATAM
          </p>

          <Reveal
            as="p"
            className="max-w-[640px] text-[clamp(22px,2.4vw,34px)] leading-[1.25] font-medium tracking-[-0.025em]"
            style={{ textShadow: '0 2px 24px rgba(0,0,0,0.9)' }}
          >
            {t('home.corridorLine')}
          </Reveal>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 font-mono text-xs text-fg-muted">
            <span className="flex items-center gap-3.5">
              <span className="chip chip-neutral">BRL</span>
              <FlowLine from="oklch(0.72 0.17 152)" to="oklch(0.88 0.16 96)" />
            </span>
            <span className="flex items-center gap-3.5">
              <span className="chip chip-neutral">USDC</span>
              <FlowLine from="oklch(0.88 0.16 96)" to="oklch(0.6 0.19 262)" />
            </span>
            <span className="chip chip-neutral">ARS · COP · MXN</span>
          </div>
        </div>
      </section>
    </div>
  );
}
