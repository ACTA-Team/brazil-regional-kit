import type { Metadata } from 'next';
import { I18nProvider } from '@/lib/i18n';
import { WalletProvider } from '@/lib/wallet';
import { SiteHeader } from '@/components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: 'Brazil Regional Kit — Stellar ramps for Brazil & LATAM',
  description:
    'PIX on/off-ramps, a multi-anchor quote router and a regional stablecoin toolkit for Stellar. Built for the Stellar Summit SP 2026 Brazil Ramps bounty.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <I18nProvider>
          <WalletProvider>
            <div className="flex min-h-dvh flex-col">
              <SiteHeader />
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
                {children}
              </main>
              <footer className="border-t border-border-subtle px-4 py-6 text-center text-xs text-ink-500">
                Stellar testnet · open source · MIT
              </footer>
            </div>
          </WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
