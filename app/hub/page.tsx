'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthContext';
import { useUnitStore } from '@/lib/stores/unitStore';

interface HubItem {
  id: number;
  title: string;
  description: string;
  category: string;
  tags: string[];
  thermoMethod: string;
  unitCount: number;
  streamCount: number;
  massErrorPct: number | null;
  converged: boolean;
  isOfficial: boolean;
  presetId: string | null;
  authorId: number | null;
  authorName: string;
  views: number;
  forks: number;
  likes: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { id: 'all', labelEn: 'All Processes', labelKo: '전체 공정' },
  { id: 'energy', labelEn: 'Energy & Power', labelKo: '에너지 · 발전' },
  { id: 'separation', labelEn: 'Separation & Distillation', labelKo: '분리 · 증류' },
  { id: 'reaction', labelEn: 'Reaction & Synthesis', labelKo: '반응 · 합성' },
  { id: 'petrochemical', labelEn: 'Petrochemical', labelKo: '석유화학' },
  { id: 'gas', labelEn: 'Gas Processing', labelKo: '가스 처리' },
  { id: 'electrochem', labelEn: 'Electrochemistry', labelKo: '전기화학' },
  { id: 'general', labelEn: 'General / Custom', labelKo: '범용 / 기타' },
];

const CAT_BADGE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  energy: { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D', label: 'Energy & Power' },
  separation: { bg: '#DBEAFE', color: '#1E40AF', border: '#93C5FD', label: 'Separation' },
  reaction: { bg: '#FCE7F3', color: '#9D174D', border: '#F9A8D4', label: 'Reaction' },
  petrochemical: { bg: '#EDE9FE', color: '#5B21B6', border: '#C4B5FD', label: 'Petrochemical' },
  gas: { bg: '#CFFAFE', color: '#155E75', border: '#67E8F9', label: 'Gas Processing' },
  electrochem: { bg: '#D1FAE5', color: '#065F46', border: '#6EE7B7', label: 'Electrochem' },
  general: { bg: '#F1F5F9', color: '#334155', border: '#CBD5E1', label: 'General' },
};

export default function ProcessHubPage() {
  const { user, loading: authLoading } = useAuth();
  const lang = useUnitStore(s => s.lang);
  const setLang = useUnitStore(s => s.setLang);
  const isEn = lang === 'en';
  const router = useRouter();

  const [items, setItems] = useState<HubItem[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<'latest' | 'popular' | 'liked'>('latest');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());

  const isAdmin = user?.role === 'admin';

  const fetchItems = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        q: search.trim(),
        category,
        sort,
      });
      const res = await fetch(`/api/hub/list?${qs.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Failed to load Process Hub.');
        setItems([]);
      } else {
        setIsPublic(Boolean(data.isPublic));
        setItems(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      setError(isEn ? 'Network error loading Process Hub.' : 'Process Hub 데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, search, category, sort, isEn]);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      fetchItems();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading, isAdmin, fetchItems]);

  const handleOpenInSimulator = async (item: HubItem) => {
    try {
      fetch(`/api/hub/fork/${item.id}`, { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch {
      // non-blocking
    }
    if (item.presetId) {
      router.push(`/flowsheet-simulator?preset=${encodeURIComponent(item.presetId)}`);
    } else {
      router.push(`/flowsheet-simulator?hub=${item.id}`);
    }
  };

  const handleCopyLink = (item: HubItem) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://chemplantstudio.com';
    const url = item.presetId
      ? `${origin}/flowsheet-simulator?preset=${encodeURIComponent(item.presetId)}`
      : `${origin}/flowsheet-simulator?hub=${item.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(prev => (prev === item.id ? null : prev)), 1800);
  };

  const handleLike = async (item: HubItem) => {
    if (likedIds.has(item.id)) return;
    setLikedIds(prev => new Set(prev).add(item.id));
    setItems(prev => prev.map(x => (x.id === item.id ? { ...x, likes: x.likes + 1 } : x)));
    try {
      await fetch(`/api/hub/like/${item.id}`, { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
  };

  const handleDelete = async (item: HubItem) => {
    const msg = isEn
      ? `Delete "${item.title}" from Process Hub?`
      : `"${item.title}" 공정을 Process Hub에서 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await fetch(`/api/hub/item/${item.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setItems(prev => prev.filter(x => x.id !== item.id));
      }
    } catch {
      // ignore
    }
  };

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B1220', color: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8' }}>Loading Process Hub...</div>
      </div>
    );
  }

  // Strict Admin-only Private Preview Lock Screen
  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: '#0B1220', color: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 460, width: '100%', background: '#111827', border: '1px solid #1F2937', borderRadius: 14, padding: 28, textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.45)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(245, 158, 11, 0.14)', border: '1px solid rgba(245, 158, 11, 0.35)', color: '#FCD34D', fontSize: 11, fontWeight: 800, marginBottom: 14 }}>
            🔒 Private Preview
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 8px' }}>
            ChemPlant Process Hub
          </h1>
          <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, margin: '0 0 20px' }}>
            {isEn
              ? 'Community flowsheet sharing is currently in private internal testing and will open to beta testers soon.'
              : '커뮤니티 공정 예제 허브는 현재 내부 비공개 테스트 중입니다. 곧 정식 오픈될 예정입니다.'}
          </p>
          <Link
            href="/flowsheet-simulator"
            style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 8, background: '#2563EB', color: '#FFFFFF', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}
          >
            {isEn ? '← Back to Flowsheet Simulator' : '← 공정 시뮬레이터로 돌아가기'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Header */}
      <header style={{ background: '#0F172A', color: '#F8FAFC', borderBottom: '1px solid #1E293B', position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/flowsheet-simulator" style={{ color: '#F8FAFC', textDecoration: 'none', fontWeight: 900, fontSize: 16, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'linear-gradient(135deg, #2563EB, #0EA5E9)', width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 }}>CP</span>
              <span>Process Hub</span>
            </Link>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 999,
                background: isPublic ? 'rgba(16, 185, 129, 0.18)' : 'rgba(245, 158, 11, 0.18)',
                border: isPublic ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(245, 158, 11, 0.45)',
                color: isPublic ? '#6EE7B7' : '#FCD34D',
              }}
            >
              {isPublic
                ? (isEn ? '🌐 Public Live' : '🌐 공개 운영 중')
                : (isEn ? '🔒 Admin Private Preview' : '🔒 관리자 전용 비공개 프리뷰')}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setLang(isEn ? 'ko' : 'en')}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1E293B', color: '#E2E8F0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              {isEn ? 'KO' : 'EN'}
            </button>
            <Link
              href="/flowsheet-simulator"
              style={{ padding: '6px 12px', borderRadius: 6, background: '#2563EB', color: '#FFFFFF', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
            >
              {isEn ? '← Open Simulator' : '← 시뮬레이터로 이동'}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <section style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)', color: '#FFFFFF', padding: '28px 20px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em' }}>
              {isEn ? 'Community Process Flowsheet Hub' : 'ChemPlant Process Hub (예제 공유 허브)'}
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: '#CBD5E1', maxWidth: 680, lineHeight: 1.55 }}>
              {isEn
                ? 'Explore, inspect, and fork converged chemical process flowsheets directly in the browser. Share your own converged PFD from the simulator toolbar.'
                : '수렴 검증된 화학공정 플로우시트를 브라우저에서 클릭 한 번으로 열어 실행·복제할 수 있습니다. 시뮬레이터 상단 [Share] 버튼으로 내 공정도 바로 게시할 수 있습니다.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#93C5FD' }}>
            <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#CBD5E1' }}>TOTAL FLOWSHEETS</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#FFFFFF' }}>{items.length}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#CBD5E1' }}>VISIBILITY</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: isPublic ? '#6EE7B7' : '#FCD34D', marginTop: 2 }}>
                {isPublic ? 'PUBLIC' : 'ADMIN ONLY'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Filters & Search */}
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 20px 48px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, flex: '1 1 320px', maxWidth: 480 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') fetchItems(); }}
              placeholder={isEn ? 'Search flowsheets, components, tags (e.g. CCGT, Benzene, NRTL)...' : '공정명, 물질명, 태그 검색 (예: CCGT, Benzene, NRTL)...'}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 13, color: '#0F172A' }}
            />
            <button
              type="button"
              onClick={() => fetchItems()}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
            >
              {isEn ? 'Search' : '검색'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>{isEn ? 'Sort:' : '정렬:'}</span>
            {([
              ['latest', isEn ? 'Latest' : '최신순'],
              ['popular', isEn ? 'Most Opened' : '인기순'],
              ['liked', isEn ? 'Most Liked' : '좋아요순'],
            ] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: sort === k ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                  background: sort === k ? '#EFF6FF' : '#FFFFFF',
                  color: sort === k ? '#1E3A8A' : '#475569',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {CATEGORIES.map(c => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: active ? '1px solid #0F172A' : '1px solid #CBD5E1',
                  background: active ? '#0F172A' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#334155',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isEn ? c.labelEn : c.labelKo}
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: 14, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
            {isEn ? 'Loading flowsheets...' : '공정 목록을 불러오는 중...'}
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, color: '#64748B', fontSize: 13 }}>
            {isEn ? 'No matching flowsheets found.' : '조건에 맞는 공유 공정이 없습니다.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {items.map(item => {
              const cat = CAT_BADGE_STYLE[item.category] ?? CAT_BADGE_STYLE.general;
              return (
                <article
                  key={item.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <div>
                    {/* Top Badges */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>
                          {cat.label}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: '#F1F5F9', color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                          {item.thermoMethod}
                        </span>
                        {item.isOfficial && (
                          <span style={{ fontSize: 9.5, fontWeight: 900, padding: '2px 6px', borderRadius: 999, background: '#DBEAFE', color: '#1D4ED8' }}>
                            ★ OFFICIAL
                          </span>
                        )}
                      </div>
                      {item.converged && (
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#059669', fontFamily: 'JetBrains Mono, monospace' }}>
                          ✓ {item.massErrorPct !== null ? `${item.massErrorPct.toFixed(2)}% err` : 'Converged'}
                        </span>
                      )}
                    </div>

                    {/* Title & Description */}
                    <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 900, color: '#0F172A', lineHeight: 1.35 }}>
                      {item.title}
                    </h2>
                    <p style={{ margin: '0 0 10px', fontSize: 12.2, color: '#475569', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.description || (isEn ? 'No description provided.' : '설명이 입력되지 않았습니다.')}
                    </p>

                    {/* Tags */}
                    {item.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {item.tags.map(tg => (
                          <span key={tg} style={{ fontSize: 10.5, fontWeight: 600, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 6px' }}>
                            #{tg}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Footer Meta & Actions */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748B', paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid #F1F5F9', fontFamily: 'JetBrains Mono, monospace' }}>
                      <span>
                        {item.unitCount} units · {item.streamCount} streams
                      </span>
                      <span>
                        by <b style={{ color: '#334155', fontFamily: 'Inter, sans-serif' }}>{item.authorName}</b>
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleOpenInSimulator(item)}
                        style={{
                          flex: 1,
                          padding: '7px 12px',
                          borderRadius: 7,
                          border: '1px solid #1E3A8A',
                          background: '#1E3A8A',
                          color: '#FFFFFF',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        ▶ {isEn ? 'Open in Simulator' : '시뮬레이터에서 열기'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyLink(item)}
                        title={isEn ? 'Copy direct share link' : '직접 공유 링크 복사'}
                        style={{
                          padding: '7px 9px',
                          borderRadius: 7,
                          border: '1px solid #CBD5E1',
                          background: copiedId === item.id ? '#ECFDF5' : '#FFFFFF',
                          color: copiedId === item.id ? '#059669' : '#334155',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {copiedId === item.id ? '✓' : '🔗'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLike(item)}
                        title={isEn ? 'Like' : '좋아요'}
                        style={{
                          padding: '7px 9px',
                          borderRadius: 7,
                          border: likedIds.has(item.id) ? '1px solid #F43F5E' : '1px solid #CBD5E1',
                          background: likedIds.has(item.id) ? '#FFF1F2' : '#FFFFFF',
                          color: likedIds.has(item.id) ? '#E11D48' : '#475569',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        ♥ {item.likes}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        title={isEn ? 'Delete (Admin)' : '삭제 (관리자)'}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 7,
                          border: '1px solid #FECACA',
                          background: '#FFFFFF',
                          color: '#DC2626',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
