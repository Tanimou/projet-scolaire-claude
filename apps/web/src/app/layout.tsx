import './globals.css';

import { Inter, JetBrains_Mono } from 'next/font/google';
import type { Metadata, Viewport } from 'next';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['500'],
});

export const metadata: Metadata = {
  title: {
    default: 'Pilotage scolaire — Le suivi scolaire qui rapproche école et famille',
    template: '%s · Pilotage scolaire',
  },
  description:
    "Plateforme de pilotage scolaire pour parents, professeurs et administrations. Notes, tendances, alertes explicables, recommandations d'action.",
  applicationName: 'Pilotage scolaire',
  authors: [{ name: 'Pilotage scolaire' }],
  generator: 'Next.js',
  keywords: ['école', 'éducation', 'notes', 'suivi scolaire', 'parents', 'professeurs'],
  referrer: 'origin-when-cross-origin',
  formatDetection: { email: false, address: false, telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
