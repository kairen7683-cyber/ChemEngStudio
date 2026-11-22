'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUnitStore } from '@/lib/stores/unitStore';
import { DocSheetIcon } from '@/components/ui/EngIcons';
import { submitBetaFeedback, type FeedbackCategory } from '@/lib/auth/authClient';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: Array<{ id: FeedbackCategory; ko: string; en: string }> = [
  { id: 'bug', ko: '버그 신고', en: 'Bug' },
  { id: 'calc', ko: '계산·수식', en: 'Calculation' },
  { id: 'feature', ko: '기능 제안', en: 'Feature' },
  { id: 'ux', ko: 'UI·사용성', en: 'UX' },
];

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const pathname = usePathname() || '/';
  const lang = useUnitStore(s => s.lang);
  const presetId = useUnitStore(s => s.presetId);
  const isEn = lang === 'en';

  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setSubmittedId(null);
    }
  }, [open]);

  if (!open) return null;

  const trimmedLen = message.trim().length;
  const canSubmit = !submitting && trimmedLen >= 2 && trimmedLen <= 2000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = message.trim();
    if (clean.length < 2) {
      setErrorMsg(
        isEn
          ? 'Please enter at least 2 characters.'
          : '피드백 내용을 2자 이상 입력해 주세요.'
      );
      return;
    }
    if (clean.length > 2000) {
      setErrorMsg(
        isEn
          ? 'Feedback must be 2000 characters or fewer.'
          : '피드백 내용은 2000자 이하로 입력해 주세요.'
      );
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await submitBetaFeedback({
        category,
        message: clean,
        page_path: pathname,
        lang,
        unit_preset: presetId,
      });
      setSubmittedId(res.id);
      setMessage('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to save feedback.'
            : '피드백 저장 중 오류가 발생했습니다.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? 'Beta Feedback' : '베타 피드백 접수'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10020,
        background: 'rgba(15, 23, 42, 0.62)',
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
          maxWidth: 500,
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #CBD5E1',
          boxShadow: '0 24px 56px rgba(15, 23, 42, 0.34)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#0F172A',
            color: '#F8FAFC',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #1E293B',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <DocSheetIcon size={15} style={{ color: '#CBD5E1' }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.2px' }}>
              {isEn ? 'Beta Feedback' : '베타 피드백 접수'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #334155',
              background: '#1E293B',
              color: '#E2E8F0',
              borderRadius: 6,
              padding: '3px 9px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isEn ? 'Close' : '닫기'}
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {submittedId !== null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                  color: '#0F172A',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
                  {isEn ? 'Feedback saved to backlog.' : '피드백이 백로그에 접수되었습니다.'}
                </div>
                <div style={{ fontSize: 11.2, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                  {isEn ? `Backlog ID #${submittedId}` : `접수 번호 #${submittedId}`}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setSubmittedId(null)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#334155',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isEn ? 'Submit Another' : '추가 작성'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#0F172A',
                    color: '#FFFFFF',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isEn ? 'Done' : '확인'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Category Pills */}
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  {isEn ? 'Category' : '유형 선택'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CATEGORIES.map(cat => {
                    const active = category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: active ? '1.5px solid #0F172A' : '1px solid #CBD5E1',
                          background: active ? '#0F172A' : '#F8FAFC',
                          color: active ? '#FFFFFF' : '#334155',
                          fontSize: 11.2,
                          fontWeight: active ? 800 : 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isEn ? cat.en : cat.ko}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Message Textarea */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <label
                    htmlFor="beta-feedback-textarea"
                    style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}
                  >
                    {isEn ? 'Details' : '상세 내용'}
                  </label>
                  <span
                    style={{
                      fontSize: 10.2,
                      fontFamily: 'JetBrains Mono, monospace',
                      color: trimmedLen > 2000 ? '#B91C1C' : '#64748B',
                    }}
                  >
                    {trimmedLen} / 2000
                  </span>
                </div>
                <textarea
                  id="beta-feedback-textarea"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder={
                    isEn
                      ? 'Describe the issue, calculation discrepancy, or feature suggestion...'
                      : '발견한 오류, 계산·수식 검토 의견, 또는 개선 아이디어를 간결히 작성해 주세요.'
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    fontSize: 12,
                    lineHeight: 1.5,
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Auto-captured Context Line */}
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: 10.5,
                  color: '#475569',
                  fontFamily: 'JetBrains Mono, monospace',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span>
                  {isEn ? 'Page' : '화면'}: {pathname}
                </span>
                <span>·</span>
                <span>
                  {isEn ? 'Units' : '단위'}: {presetId}
                </span>
                <span>·</span>
                <span>
                  {isEn ? 'Lang' : '언어'}: {lang.toUpperCase()}
                </span>
              </div>

              {errorMsg && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: '#FEF2F2',
                    border: '1px solid #FCA5A5',
                    color: '#991B1B',
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {errorMsg}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#334155',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isEn ? 'Cancel' : '취소'}
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: canSubmit ? '#0F172A' : '#94A3B8',
                    color: '#FFFFFF',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting
                    ? isEn
                      ? 'Saving...'
                      : '저장 중...'
                    : isEn
                      ? 'Submit Feedback'
                      : '피드백 제출'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
