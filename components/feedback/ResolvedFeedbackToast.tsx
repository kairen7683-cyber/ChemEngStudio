'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthContext';
import { useUnitStore } from '@/lib/stores/unitStore';

interface MyFeedbackItem {
  id: number;
  category: string;
  message: string;
  status: string;
  admin_note: string;
  created_at: string;
}

const SEEN_STORAGE_KEY = 'chemplant-seen-resolved-fb-v1';

function readSeenIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(n => Number(n)).filter(n => Number.isFinite(n)));
    }
  } catch {
    // ignore
  }
  return new Set();
}

function writeSeenIds(ids: Set<number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

export default function ResolvedFeedbackToast() {
  const { authenticated, user } = useAuth();
  const lang = useUnitStore(s => s.lang);
  const isEn = lang === 'en';
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!authenticated || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/feedback/my', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: MyFeedbackItem[] };
        if (cancelled || !Array.isArray(data.items)) return;
        const seen = readSeenIds();
        const unseenResolved = data.items.filter(
          it => it.status === 'resolved' && !seen.has(it.id)
        );
        if (unseenResolved.length > 0) {
          setItems(unseenResolved);
          setVisible(true);
        }
      } catch {
        // silent fail on offline / static dev
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, user?.id]);

  if (!visible || items.length === 0) return null;

  const handleDismiss = () => {
    const seen = readSeenIds();
    items.forEach(it => seen.add(it.id));
    writeSeenIds(seen);
    setVisible(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 9998,
        width: 'min(390px, calc(100vw - 28px))',
        background: '#0F172A',
        color: '#F8FAFC',
        border: '1px solid #334155',
        borderLeft: '4px solid #10B981',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 16px 36px rgba(15, 23, 42, 0.35)',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 999,
              background: '#10B981',
              color: '#0F172A',
              fontSize: 12,
              fontWeight: 900,
              flexShrink: 0,
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 12.8, fontWeight: 800, color: '#FFFFFF' }}>
            {isEn
              ? `${items.length} Reported Issue${items.length > 1 ? 's' : ''} Fixed`
              : `제보하신 버그·개선 ${items.length}건이 수정 반영되었습니다`}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close notification"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#94A3B8',
            fontSize: 14,
            fontWeight: 800,
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          maxHeight: 210,
          overflowY: 'auto',
          marginBottom: 10,
        }}
      >
        {items.map(it => {
          const firstLine = (it.message || '').split('\n')[0].trim();
          const shortMsg = firstLine.length > 68 ? `${firstLine.slice(0, 68)}…` : firstLine;
          return (
            <div
              key={it.id}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 8,
                padding: '7px 10px',
              }}
            >
              <div style={{ fontSize: 11.2, fontWeight: 700, color: '#E2E8F0', lineHeight: 1.4 }}>
                • {shortMsg}
              </div>
              {it.admin_note && (
                <div style={{ fontSize: 10.6, color: '#6EE7B7', marginTop: 3, lineHeight: 1.4 }}>
                  → {it.admin_note}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 10.5, color: '#94A3B8' }}>
          {isEn
            ? 'Thank you for helping improve ChemPlant Studio.'
            : '소중한 제보에 감사드립니다.'}
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid #10B981',
            background: '#10B981',
            color: '#0F172A',
            fontSize: 11.2,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {isEn ? 'Got it' : '확인'}
        </button>
      </div>
    </div>
  );
}
