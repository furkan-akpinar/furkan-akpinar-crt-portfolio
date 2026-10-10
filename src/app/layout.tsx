import type { Metadata } from "next";
import type { ReactNode } from "react";
import "lenis/dist/lenis.css";
import "./globals.css";
import { portfolio } from "@/content/portfolio";

export const metadata: Metadata = {
  metadataBase: new URL('https://furkanakpinar.dev/'),
  title: `${portfolio.home.name} — ${portfolio.home.role}`,
  description: portfolio.home.description,
  authors: [{ name: portfolio.name, url: portfolio.github }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website', locale: 'tr_TR', url: '/', siteName: portfolio.name,
    title: `${portfolio.home.name} — Interactive Portfolio`,
    description: portfolio.home.description,
    images: [{ url: '/social-preview.png', width: 1440, height: 900, alt: 'Furkan Akpınar — CRT ekranlı etkileşimli portföy' }],
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preload" href="/fonts/STIXTwoText-Variable.72f5d1276962.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/STIXTwoText-Italic-Variable.971179dd0e68.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/VT323-Regular.558e194d0f8d.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
