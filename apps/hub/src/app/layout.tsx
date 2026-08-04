import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { I18nProvider } from '@/client/i18n';
import { WalletProvider } from '@/client/wallet';
import { AmbientBackground } from '@/components/layout/AmbientBackground';
import { Header } from '@/components/layout/header';
import { RampUIBridge } from '@/components/layout/RampUIBridge';
import './globals.css';

/*
 * Two families, loaded as CSS variables so `--font-sans` and `--font-mono` in
 * globals.css resolve to the real thing.
 *
 * Space Grotesk carries UI, headings and body: its tight apertures and short
 * descenders are what let a 68px headline sit at -0.04em tracking without
 * turning to mush. IBM Plex Mono is reserved for what a reader must compare
 * character by character — hashes, addresses, order ids, rails, rates.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Brazil Regional Kit · Stellar ramps for Brazil and LATAM',
  description:
    'PIX on/off-ramps, a multi-anchor quote router and a regional stablecoin toolkit for Stellar. Built for the Stellar Summit SP 2026 Brazil Ramps bounty.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${spaceGrotesk.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-canvas font-sans antialiased">
        {/* <Reveal> parks its resting state in inline styles so the very first
            paint is already right. Inline beats a class, so the only way to
            clear it without the observer is !important — and the only time that
            is needed is when scripting is off entirely. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}`}</style>
        </noscript>

        <AmbientBackground />

        <I18nProvider>
          <RampUIBridge>
            <WalletProvider>
              {/* The three lights as a one-pixel rule, capping the page. */}
              <span aria-hidden="true" className="flag-rule fixed inset-x-0 top-0 z-50 h-px" />

              <div className="relative z-10 flex min-h-dvh flex-col">
                <Header />
                <main className="flex-1">{children}</main>
                <footer className="border-t border-line px-6 pt-7 pb-11 sm:px-10 lg:px-14">
                  <div className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-x-6 gap-y-2 font-mono text-xs text-fg-subtle">
                    <span>Brazil Regional Kit</span>
                    <span>Stellar testnet · SEP-6 · SEP-31 · x402 · MIT</span>
                  </div>
                </footer>
              </div>
            </WalletProvider>
          </RampUIBridge>
        </I18nProvider>
      </body>
    </html>
  );
}
