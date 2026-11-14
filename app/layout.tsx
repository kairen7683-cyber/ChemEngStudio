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
  title: 'ChemEng Studio — 화공 엔지니어링 통합 설계 플랫폼',
  description: '화공 단위장치 설계(ChemPro) · 플랜트 공정 PFD & 물질수지 · 특수공정 · PEP 경제성 · 열역학 물성 시뮬레이션 통합 엔지니어링 워크스테이션',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ChemEng',
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
