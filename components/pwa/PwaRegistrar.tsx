'use client';

import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaStateSnapshot {
  canPrompt: boolean;
  isStandalone: boolean;
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
  return Boolean(mq || iosStandalone);
}

function getSnapshot(): PwaStateSnapshot {
  return {
    canPrompt: Boolean(deferredPromptRef),
    isStandalone: standaloneState,
  };
}

export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

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

      window.addEventListener('beforeinstallprompt', (ev: Event) => {
        ev.preventDefault();
        deferredPromptRef = ev as BeforeInstallPromptEvent;
        notifyListeners();
      });

      window.addEventListener('appinstalled', () => {
        deferredPromptRef = null;
        standaloneState = true;
        notifyListeners();
      });

      const mq = window.matchMedia?.('(display-mode: standalone)');
      mq?.addEventListener?.('change', () => {
        standaloneState = detectStandalone();
        notifyListeners();
      });
    }
  }, []);

  return null;
}

export function PwaInstallButton({ variant = 'header' }: { variant?: 'header' | 'login' }) {
  const [snap, setSnap] = useState<PwaStateSnapshot>(() => ({ canPrompt: false, isStandalone: false }));
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

  const handleInstallClick = async () => {
    if (deferredPromptRef) {
      try {
        await deferredPromptRef.prompt();
        const choice = await deferredPromptRef.userChoice;
        if (choice?.outcome === 'accepted') {
          deferredPromptRef = null;
          standaloneState = true;
          notifyListeners();
          return;
        }
      } catch {
        // Fallback to manual guide modal below
      }
    }
    setShowGuide(true);
  };

  return (
    <>
      {variant === 'login' ? (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #BAE6FD',
            background: '#F0F9FF',
            color: '#0369A1',
            fontSize: 11.5,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span>📲</span>
          <span>{snap.canPrompt ? '앱으로 바로 설치하기 (전체화면 실행)' : '모바일·PC 앱(PWA) 설치 방법'}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          title="브라우저 주소창 없이 독립 앱으로 실행할 수 있도록 설치합니다"
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid #0EA5E9',
            background: '#0C4A6E',
            color: '#E0F2FE',
            fontSize: 10.2,
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
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
            background: 'rgba(15, 23, 42, 0.65)',
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
              maxWidth: 400,
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
                  src="/icon-192.png?v=2"
                  alt="ChemEng Studio"
                  style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 900 }}>ChemEng Studio 앱 설치 안내</span>
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

            <div style={{ padding: 16, fontSize: 12, lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  color: '#92400E',
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                기존에 만들어 둔 홈 화면 바로가기 아이콘이 있다면 <b>먼저 삭제</b>한 뒤 아래 방법으로 다시 설치해야 새 앱 아이콘과 전체화면 앱 모드가 적용됩니다.
              </div>

              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ fontWeight: 900, color: '#0F172A', marginBottom: 4 }}>🤖 Android (Chrome / 삼성 인터넷 / Edge)</div>
                <div style={{ color: '#475569' }}>
                  브라우저 우측 상단/하단 <b>메뉴(⋮ / ≡) → 앱 설치</b> 또는 <b>홈 화면에 추가 → 설치</b>를 누르세요. Chrome에서는 &quot;추가 중...&quot; 후 실제 앱(WebAPK)으로 설치됩니다.
                </div>
              </div>

              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ fontWeight: 900, color: '#0F172A', marginBottom: 4 }}>🍎 iPhone / iPad (Safari)</div>
                <div style={{ color: '#475569' }}>
                  하단 <b>공유 버튼(□↑) → 홈 화면에 추가</b>를 누르면 주소창 없는 독립 앱으로 실행됩니다.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
