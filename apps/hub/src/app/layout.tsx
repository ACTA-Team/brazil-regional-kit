import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import { I18nProvider } from '@/client/i18n';
import { WalletProvider } from '@/client/wallet';
import { Header } from '@/components/layout/header';
import { RampUIBridge } from '@/components/layout/RampUIBridge';
import './globals.css';

/*
 * The manual's type system, loaded as CSS variables so `--font-sans` and
 * `--font-mono` in globals.css resolve to the real families.
 *
 * Plus Jakarta Sans 300–800 carries UI, headings and body. Geist Mono is
 * reserved for what a reader must compare character by character: hashes,
 * addresses, order ids, rates.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-geist-mono',
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
      className={`${jakarta.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <I18nProvider>
          <RampUIBridge>
            <WalletProvider>
              <div className="flex min-h-dvh flex-col">
                <Header />
                <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
                  {children}
                </main>
                <footer className="border-t border-line px-4 py-8">
                  <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-fg-subtle">
                    <span>Stellar testnet</span>
                    <span aria-hidden="true">·</span>
                    <span>open source, MIT</span>
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
