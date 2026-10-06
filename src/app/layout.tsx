import type { Metadata } from "next";
import type { ReactNode } from "react";
import "lenis/dist/lenis.css";
import "./globals.css";
import { portfolio } from "@/content/portfolio";

export const metadata: Metadata = {
  metadataBase: new URL('https://furkan-akpinar-crt-portfolio.furkan-akpinar.workers.dev/'),
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
  return <html lang="tr"><body>{children}</body></html>;
}
