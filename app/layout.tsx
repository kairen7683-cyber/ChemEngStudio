import type { Metadata, Viewport } from 'next';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import { AuthProvider } from '@/components/auth/AuthContext';
import AuthGate from '@/components/auth/AuthGate';
import AdminConsoleModal from '@/components/auth/AdminConsoleModal';
import { PwaRegistrar } from '@/components/pwa/PwaRegistrar';
import './globals.css';

export const viewport: Viewport = {
  themeColor: '#0F172A',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL('https://chemplantstudio.com'),
  title: 'ChemPlant Studio — Chemical Process Simulator & Equipment Design Suite',
  description:
    'Web-native chemical process flowsheet simulation (MESH distillation, reactors, LLE), rigorous TEMA & API 662 heat exchanger rating, API 520/526 PSV & API 521 flare network design, electrolyte thermodynamics, and official .xlsx engineering datasheets.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ChemPlant Studio — Chemical Process Simulator & Equipment Design Suite',
    description:
      'Rigorous chemical process flowsheet simulation, TEMA / API 662 heat exchanger rating, API 520/521 PSV & flare design, and official engineering datasheets in one web workspace.',
    url: 'https://chemplantstudio.com',
    siteName: 'ChemPlant Studio',
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['ko_KR'],
    images: [
      {
        url: '/icon-512-v2.png',
        width: 512,
        height: 512,
        alt: 'ChemPlant Studio',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'ChemPlant Studio — Chemical Process Simulator & Equipment Design Suite',
    description:
      'Web-native chemical process simulation, TEMA/API 662 heat exchanger rating, API 520/521 PSV & flare sizing, and official .xlsx datasheets.',
    images: ['/icon-512-v2.png'],
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ChemPlant Studio',
  },
  icons: {
    icon: [
      { url: '/icon-192-v2.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512-v2.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon-v2.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico?v=2',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'ChemPlant Studio',
              applicationCategory: 'EngineeringApplication',
              operatingSystem: 'Web Browser',
              url: 'https://chemplantstudio.com',
              description:
                'Web-native chemical process flowsheet simulator (MESH distillation, 5 reactor models, Gas/Steam Turbines, PR/SRK/NRTL/eNRTL), TEMA & API 662 heat exchanger rating, and API 520/521 PSV & flare sizing.',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              publisher: {
                '@type': 'Organization',
                name: 'ChemPlant Studio',
                url: 'https://chemplantstudio.com',
                email: 'support@chemplantstudio.com',
              },
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{window.__chemengDeferredPrompt=null;window.__chemengInstalled=false;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__chemengDeferredPrompt=e;window.dispatchEvent(new Event('chemeng:pwa-updated'));});window.addEventListener('appinstalled',function(){window.__chemengDeferredPrompt=null;window.__chemengInstalled=true;window.dispatchEvent(new Event('chemeng:pwa-updated'));});if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});}}catch(_){}})();`,
          }}
        />
      </head>
      <body>
        <PwaRegistrar />
        <AuthProvider>
          <AuthGate>
            <div className="app-layout">
              <Header />
              <div className="app-body">
                <Sidebar />
                <main className="app-main">
                  {children}
                </main>
              </div>
            </div>
            <AdminConsoleModal />
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
