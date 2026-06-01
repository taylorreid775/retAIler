import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'RetAIler — Compare prices across Canadian retailers',
  description:
    'Find the cheapest price for sporting goods across Canadian retailers like Sport Chek, MEC, and Sporting Life.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-xl font-bold">
              Ret<span className="text-brand-600">AI</span>ler
            </Link>
            <Link
              href={process.env.NEXT_PUBLIC_DASHBOARD_URL ?? '#'}
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              For retailers →
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-[var(--border)] py-8 text-center text-xs text-[var(--muted-foreground)]">
          Prices are collected from public retailer pages and may be delayed. RetAIler may earn
          affiliate commission on outbound links.
        </footer>
      </body>
    </html>
  );
}
