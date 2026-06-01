import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'RetAIler Intelligence',
  description: 'Canadian retail competitive intelligence dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
