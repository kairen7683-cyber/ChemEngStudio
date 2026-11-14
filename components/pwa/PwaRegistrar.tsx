'use client';

import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __chemengDeferredPrompt?: BeforeInstallPromptEvent | null;
    __chemengInstalled?: boolean;
  }
}

interface PwaStateSnapshot {
  canPrompt: boolean;
  isStandalone: boolean;
  isAutoInstallHint: boolean;
}

let deferredPromptRef: BeforeInstallPromptEvent | null = null;
let standaloneState = false;
let initialized = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mq || iosStandalone || window.__chemengInstalled);
}

function getActivePrompt(): BeforeInstallPromptEvent | null {
  if (deferredPromptRef) return deferredPromptRef;
  if (typeof window !== 'undefined' && window.__chemengDeferredPrompt) {
    deferredPromptRef = window.__chemengDeferredPrompt;
    return deferredPromptRef;
  }
  return null;
}

function getSnapshot(): PwaStateSnapshot {
  const isAuto =
    typeof window !== 'undefined' && window.location.search.includes('autoinstall=1');
  return {
    canPrompt: Boolean(getActivePrompt()),
    isStandalone: standaloneState,
    isAutoInstallHint: isAuto,
  };
}

export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.__chemengDeferredPrompt && !deferredPromptRef) {
      deferredPromptRef = window.__chemengDeferredPrompt;
    }
    standaloneState = detectStandalone();
    notifyListeners();

    if (!initialized) {
      initialized = true;

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .catch(() => {
            // Ignore SW registration failure on unsupported browsers
          });
      }

      const onCustomUpdate = () => {
        if (window.__chemengDeferredPrompt) {
          deferredPromptRef = window.__chemengDeferredPrompt;
        }
        standaloneState = detectStandalone();
        notifyListeners();
      };

      const onBeforeInstall = (ev: Event) => {
        ev.preventDefault();
        const bip = ev as BeforeInstallPromptEvent;
        deferredPromptRef = bip;
        window.__chemengDeferredPrompt = bip;
        notifyListeners();
      };

      const onAppInstalled = () => {
        deferredPromptRef = null;
        window.__chemengDeferredPrompt = null;
        window.__chemengInstalled = true;
        standaloneState = true;
        notifyListeners();
      };

      window.addEventListener('chemeng:pwa-updated', onCustomUpdate);
      window.addEventListener('beforeinstallprompt', onBeforeInstall);
      window.addEventListener('appinstalled', onAppInstalled);

      const mq = window.matchMedia?.('(display-mode: standalone)');
      mq?.addEventListener?.('change', () => {
        standaloneState = detectStandalone();
        notifyListeners();
      });
    }
  }, []);

  return null;
}

export function PwaInstallButton({
  variant = 'header',
}: {
  variant?: 'header' | 'login' | 'login-header';
}) {
  const [snap, setSnap] = useState<PwaStateSnapshot>(() => ({
    canPrompt: false,
    isStandalone: false,
    isAutoInstallHint: false,
  }));
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    standaloneState = detectStandalone();
    setSnap(getSnapshot());
    const onChange = () => setSnap(getSnapshot());
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  if (snap.isStandalone) return null;

  const host = typeof window !== 'undefined' ? window.location.host : 'chemeng.34-47-91-5.sslip.io';
  const chromeIntentUrl = `intent://${host}/?autoinstall=1#Intent;scheme=https;package=com.android.chrome;end`;
  const samsungIntentUrl = `intent://${host}/?autoinstall=1#Intent;scheme=https;package=com.sec.android.app.sbrowser;end`;

  const handleInstallClick = async () => {
    const promptObj = getActivePrompt();
    if (promptObj) {
      try {
        await promptObj.prompt();
        const choice = await promptObj.userChoice;
        if (choice?.outcome === 'accepted') {
          deferredPromptRef = null;
          window.__chemengDeferredPrompt = null;
          window.__chemengInstalled = true;
          standaloneState = true;
          notifyListeners();
          return;
        }
      } catch {
        // Fallback to action modal below
      }
    }
    setShowGuide(true);
  };

  return (
    <>
      {variant === 'login-header' ? (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          title="홈 화면·바탕화면에 독립 앱(PWA)으로 설치"
          style={{
            padding: '5px 10px',
            borderRadius: 999,
            border: '1px solid #22D3EE',
            background: snap.canPrompt
              ? 'linear-gradient(135deg, #06B6D4 0%, #0EA5E9 100%)'
              : 'rgba(6, 182, 212, 0.22)',
            color: snap.canPrompt ? '#082F49' : '#67E8F9',
            fontSize: 11,
            fontWeight: 900,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            boxShadow: snap.canPrompt ? '0 2px 10px rgba(6, 182, 212, 0.35)' : 'none',
          }}
        >
          <span>📲</span>
          <span>앱 설치</span>
        </button>
      ) : variant === 'login' ? (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 9,
            border: snap.canPrompt ? '1.5px solid #06B6D4' : '1.5px solid #0284C7',
            background: snap.canPrompt
              ? 'linear-gradient(135deg, #0891B2 0%, #0284C7 100%)'
              : 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)',
            color: '#FFFFFF',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.22)',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>📲</span>
            <span>스마트폰 · PC 앱(PWA) 바로 설치</span>
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: '#BAE6FD' }}>
            {snap.canPrompt
              ? '설치 준비 완료 — 터치하면 즉시 독립 앱으로 설치됩니다'
              : '터치하여 전체화면 독립 앱으로 설치하기'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          title="브라우저 주소창 없이 독립 앱으로 실행할 수 있도록 설치합니다"
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid #22D3EE',
            background: '#0C4A6E',
            color: '#E0F2FE',
            fontSize: 10.2,
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          📲 앱 설치
        </button>
      )}

      {showGuide && (
        <div
          onClick={() => setShowGuide(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10050,
            background: 'rgba(15, 23, 42, 0.68)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#FFFFFF',
              color: '#0F172A',
              borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
              border: '1px solid #E2E8F0',
            }}
          >
            <div
              style={{
                background: '#0F172A',
                color: '#FFFFFF',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src="/icon-192-v2.png"
                  alt="ChemEng Studio"
                  style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 900 }}>ChemEng Studio 앱(PWA) 설치</span>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  border: '1px solid #334155',
                  background: '#1E293B',
                  color: '#E2E8F0',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>

            <div style={{ padding: 16, fontSize: 12, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/?autoinstall=1';
                  }}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#0284C7',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  🔄 서비스워커 활성화 새로고침 후 다시 시도
                </button>

                <a
                  href={chromeIntentUrl}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    textDecoration: 'none',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#F8FAFC',
                    color: '#0F172A',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  🌐 Android Chrome 정식 앱으로 열어서 설치
                </a>

                <a
                  href={samsungIntentUrl}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    textDecoration: 'none',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #C7D2FE',
                    background: '#EEF2FF',
                    color: '#3730A3',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  🌌 삼성 인터넷으로 열기 (주소창 `+` 버튼 설치)
                </a>
              </div>

              <div
                style={{
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  color: '#92400E',
                  fontSize: 11.2,
                  fontWeight: 700,
                }}
              >
                Chrome에서 자동 설치창이 안 뜬다면 <b>이미 앱 서랍(모든 앱 목록)에 이전에 설치한 아이콘이 남아 있기 때문</b>입니다. 기존 아이콘·앱을 삭제한 뒤 위 새로고침 버튼을 누르면 <code>앱 설치</code> 창이 뜹니다.
              </div>

              <div style={{ fontSize: 11.2, color: '#475569' }}>
                • <b>Chrome 메뉴 수동 설치</b>: 우측 상단 <code>⋮</code> → <code>공유...</code> → 아래 아이콘 줄 오른쪽 끝 <code>홈 화면에 추가</code> 또는 <code>앱 설치</code><br />
                • <b>삼성 인터넷</b>: 주소창 오른쪽 <code>↓/+</code> 아이콘 또는 <code>≡ → 현재 페이지 추가 → 홈 화면</code><br />
                • <b>iPhone Safari</b>: 하단 <code>공유(□↑) → 홈 화면에 추가</code>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
