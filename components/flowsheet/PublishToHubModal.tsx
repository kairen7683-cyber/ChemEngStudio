'use client';

import React, { useState } from 'react';

interface PublishToHubModalProps {
  open: boolean;
  onClose: () => void;
  isEn: boolean;
  isAdmin: boolean;
  defaultAuthorName?: string;
  userEmail?: string;
  defaultTitle: string;
  thermoMethod: string;
  unitCount: number;
  streamCount: number;
  massErrorPct: number | null;
  converged: boolean;
  buildFlowsheetPayload: () => Record<string, unknown>;
}

const NICK_PREFIXES = [
  'ChemEng',
  'ProcessPro',
  'Reflux',
  'Catalyst',
  'Thermo',
  'Distill',
  'Reactor',
  'Pinch',
  'Syngas',
  'Enthalpy',
];

function genRandomHandle(): string {
  const p = NICK_PREFIXES[Math.floor(Math.random() * NICK_PREFIXES.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${p}_${n}`;
}

const HUB_CATS = [
  { id: 'energy', label: 'Energy & Power' },
  { id: 'separation', label: 'Separation & Distillation' },
  { id: 'reaction', label: 'Reaction & Synthesis' },
  { id: 'petrochemical', label: 'Petrochemical' },
  { id: 'gas', label: 'Gas Processing' },
  { id: 'electrochem', label: 'Electrochemistry' },
  { id: 'general', label: 'General / Custom' },
];

export default function PublishToHubModal({
  open,
  onClose,
  isEn,
  isAdmin,
  defaultAuthorName = '',
  userEmail = '',
  defaultTitle,
  thermoMethod,
  unitCount,
  streamCount,
  massErrorPct,
  converged,
  buildFlowsheetPayload,
}: PublishToHubModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [authorName, setAuthorName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [tagsText, setTagsText] = useState('');
  const [asOfficial, setAsOfficial] = useState(isAdmin);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle || '');
      const cleanDef = (defaultAuthorName || '').trim();
      const emailPrefix = (userEmail || '').split('@')[0]?.trim().toLowerCase() || '';
      const needsRandom =
        !cleanDef ||
        cleanDef.includes('@') ||
        (emailPrefix.length > 0 && cleanDef.toLowerCase() === emailPrefix);
      setAuthorName(needsRandom ? genRandomHandle() : cleanDef);
      setDescription('');
      setTagsText('');
      setError(null);
      setPublishedId(null);
      setCopied(false);
    }
  }, [open, defaultTitle, defaultAuthorName, userEmail]);

  if (!open) return null;

  const shareUrl =
    publishedId && typeof window !== 'undefined'
      ? `${window.location.origin}/flowsheet-simulator?hub=${publishedId}`
      : '';

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      setError(isEn ? 'Title must be at least 3 characters.' : '제목은 3글자 이상 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payloadObj = buildFlowsheetPayload();
      const res = await fetch('/api/hub/publish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          authorName: authorName.trim(),
          description: description.trim(),
          category,
          tags: tagsText
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 8),
          thermoMethod,
          unitCount,
          streamCount,
          massErrorPct,
          converged,
          asOfficial: isAdmin && asOfficial,
          flowsheetJson: payloadObj,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Publish failed.');
      } else {
        setPublishedId(data.item?.id ?? null);
      }
    } catch {
      setError(isEn ? 'Network error while publishing.' : '게시 중 네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #CBD5E1',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
          overflow: 'hidden',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ padding: '14px 18px', background: '#0F172A', color: '#FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900 }}>
              {isEn ? '⬆ Publish to Process Hub' : '⬆ Process Hub에 공정 공유'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: 'rgba(245, 158, 11, 0.2)', color: '#FCD34D' }}>
              🔒 Private Preview
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 16, cursor: 'pointer', fontWeight: 800 }}
          >
            ✕
          </button>
        </div>

        {publishedId ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', fontSize: 13, fontWeight: 700 }}>
              ✓ {isEn ? 'Published to Process Hub!' : 'Process Hub에 성공적으로 등록되었습니다!'}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#475569', display: 'block', marginBottom: 4 }}>
                {isEn ? 'Direct Share Link' : '직접 열기 링크'}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  readOnly
                  value={shareUrl}
                  style={{ flex: 1, padding: '7px 9px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', color: '#0F172A' }}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(shareUrl).catch(() => {});
                    setCopied(true);
                  }}
                  style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                >
                  {copied ? (isEn ? 'Copied!' : '복사됨!') : (isEn ? 'Copy' : '복사')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <a
                href="/hub"
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
              >
                {isEn ? 'Open in Hub ↗' : 'Process Hub에서 보기 ↗'}
              </a>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '8px 14px', borderRadius: 7, border: 'none', background: '#0F172A', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
              >
                {isEn ? 'Done' : '닫기'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePublish} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Live Flowsheet Snapshot Metrics */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px', borderRadius: 7, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#334155' }}>
              <span><b>{unitCount}</b> units</span>
              <span>·</span>
              <span><b>{streamCount}</b> streams</span>
              <span>·</span>
              <span>Thermo: <b>{thermoMethod}</b></span>
              <span>·</span>
              <span style={{ color: converged ? '#059669' : '#D97706', fontWeight: 800 }}>
                {converged ? `✓ ${massErrorPct !== null ? `${massErrorPct.toFixed(2)}% err` : 'Converged'}` : 'Not Run'}
              </span>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', display: 'block', marginBottom: 4 }}>
                {isEn ? 'Process Title *' : '공정 제목 *'}
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Methanol-Water 20-Stage Distillation"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12.5, color: '#0F172A' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', display: 'block', marginBottom: 4 }}>
                {isEn ? 'Description' : '공정 설명'}
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={isEn ? 'Operating basis, feed conditions, key separation targets...' : '운전 조건, 피드 조성, 주요 설계 포인트 등을 간단히 적어주세요.'}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12.5, color: '#0F172A', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', display: 'block', marginBottom: 4 }}>
                  {isEn ? 'Category' : '카테고리'}
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  style={{ width: '100%', padding: '7px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, color: '#0F172A', background: '#FFFFFF' }}
                >
                  {HUB_CATS.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', display: 'block', marginBottom: 4 }}>
                  {isEn ? 'Tags (comma-separated)' : '태그 (쉼표 구분)'}
                </label>
                <input
                  type="text"
                  value={tagsText}
                  onChange={e => setTagsText(e.target.value)}
                  placeholder="PR, Distillation, Recycle"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, color: '#0F172A' }}
                />
              </div>
            </div>

            {!(isAdmin && asOfficial) && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', display: 'block', marginBottom: 4 }}>
                  {isEn ? 'Author Nickname (public handle — email is never shown)' : '작성자 별명 (공개 닉네임 · 이메일은 노출되지 않음)'}
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    maxLength={32}
                    value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    placeholder="e.g. ChemEng_4821"
                    style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12, color: '#0F172A' }}
                  />
                  <button
                    type="button"
                    onClick={() => setAuthorName(genRandomHandle())}
                    title={isEn ? 'Generate random nickname' : '무작위 별명 다시 생성'}
                    style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#334155', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    🎲 {isEn ? 'Random' : '랜덤'}
                  </button>
                </div>
              </div>
            )}

            {isAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#334155', cursor: 'pointer' }}>
                <input type="checkbox" checked={asOfficial} onChange={e => setAsOfficial(e.target.checked)} />
                <span>{isEn ? 'Publish as ★ Official (ChemPlant Team)' : '★ Official (ChemPlant Team) 공식 예제로 등록'}</span>
              </label>
            )}

            {error && (
              <div style={{ padding: '7px 10px', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 11.5 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {isEn ? 'Cancel' : '취소'}
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #1E3A8A', background: '#1E3A8A', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}
              >
                {submitting ? (isEn ? 'Publishing...' : '게시 중...') : (isEn ? 'Publish to Hub' : 'Hub에 게시')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
