'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUnitStore } from '@/lib/stores/unitStore';
import { submitBetaFeedback } from '@/lib/auth/authClient';

interface ProcessRequestModalProps {
  open: boolean;
  onClose: () => void;
  lockedExampleLabel?: string | null;
}

const THERMO_OPTIONS = ['PR (Peng-Robinson)', 'NRTL (Non-Ideal / Azeotrope)', 'eNRTL (Electrolyte)', 'Batch / Semi-Batch', 'Not Sure / Auto'];

export default function ProcessRequestModal({
  open,
  onClose,
  lockedExampleLabel,
}: ProcessRequestModalProps) {
  const pathname = usePathname() || '/';
  const lang = useUnitStore(s => s.lang);
  const presetId = useUnitStore(s => s.presetId);
  const isEn = lang === 'en';

  const [processName, setProcessName] = useState('');
  const [components, setComponents] = useState('');
  const [thermoMode, setThermoMode] = useState(THERMO_OPTIONS[0]);
  const [details, setDetails] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [attachedFile, setAttachedFile] = useState<{ name: string; sizeKb: number; base64: string } | null>(null);
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
      if (lockedExampleLabel && !processName) {
        setProcessName('');
      }
    }
  }, [open, lockedExampleLabel, processName]);

  if (!open) return null;

  const canSubmit = !submitting && processName.trim().length >= 2;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg(isEn ? 'Attachment must be 8 MB or smaller.' : '첨부파일은 최대 8MB까지 업로드할 수 있습니다.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',', 2)[1] : result;
      setAttachedFile({
        name: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        base64,
      });
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processName.trim().length < 2) {
      setErrorMsg(isEn ? 'Please enter the process name (at least 2 characters).' : '요청하실 공정명을 2자 이상 입력해 주세요.');
      return;
    }
    const lines = [
      '[PROCESS_EXAMPLE_REQUEST]',
      `Process Name: ${processName.trim()}`,
      `Key Feeds / Products: ${components.trim() || '(not specified)'}`,
      `Thermo / Mode: ${thermoMode}`,
      lockedExampleLabel ? `Triggered From Locked Example: ${lockedExampleLabel}` : null,
      details.trim() ? `Conditions / Notes: ${details.trim()}` : null,
      contactEmail.trim() ? `Notify Email: ${contactEmail.trim()}` : null,
    ].filter(Boolean);
    const compiledMessage = lines.join('\n').slice(0, 1990);

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await submitBetaFeedback({
        category: 'feature',
        message: compiledMessage,
        page_path: pathname,
        lang,
        unit_preset: presetId,
        attachment_name: attachedFile?.name,
        attachment_base64: attachedFile?.base64,
      });
      setSubmittedId(res.id);
      setProcessName('');
      setComponents('');
      setDetails('');
      setAttachedFile(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Failed to submit process request.'
            : '프로세스 요청 접수 중 오류가 발생했습니다.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? 'Request Process Example' : '프로세스 예제 요청'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(15, 23, 42, 0.56)',
        backdropFilter: 'blur(3px)',
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
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid #CBD5E1',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
          color: '#0F172A',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#F8FAFC',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
              {lockedExampleLabel
                ? isEn
                  ? '🔒 Pro Process Example'
                  : '🔒 Pro 구독 전용 프로세스 예제'
                : isEn
                  ? 'Request a Process Example'
                  : '프로세스 예제 제작 요청'}
            </div>
            <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
              {isEn
                ? 'Tell us which chemical process PFD you want next — we build & release requested processes regularly.'
                : '원하시는 화학공정 PFD를 요청해 주시면 검토 후 순차적으로 제작·배포해 드립니다.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid #CBD5E1',
              background: '#FFFFFF',
              color: '#475569',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {lockedExampleLabel && (
            <div
              style={{
                marginBottom: 14,
                padding: '12px 14px',
                borderRadius: 8,
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                fontSize: 12,
                color: '#1E3A8A',
                lineHeight: 1.55,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 4 }}>
                🔒 {lockedExampleLabel}
              </div>
              <div>
                {isEn
                  ? 'This industrial process is part of our Pro Process Library. You can run 3 Free Process Examples (B–T Distillation, HDA Recycle, EtOAc NRTL + Decanter) right now, or request early access / a custom process below.'
                  : '이 산업 공정은 Pro 구독 전용 라이브러리에 포함되어 있습니다. 현재 3종의 무료 대표 공정(B–T 증류 · HDA 리사이클 · EtOAc NRTL 디캔터)은 즉시 실행 가능하며, 아래 양식으로 우선 공개 또는 원하시는 공정을 요청하실 수 있습니다.'}
              </div>
            </div>
          )}

          {submittedId !== null ? (
            <div
              style={{
                padding: '18px 16px',
                borderRadius: 8,
                background: '#ECFDF5',
                border: '1px solid #A7F3D0',
                color: '#065F46',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>
                {isEn ? '✓ Process Request Submitted!' : '✓ 프로세스 예제 요청이 접수되었습니다!'}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {isEn
                  ? `Request #${submittedId} has been logged. Our process engineering team reviews requests for upcoming Process Example releases.`
                  : `요청 번호 #${submittedId}으로 접수되었습니다. 검토 후 신규 프로세스 예제 업데이트에 반영하겠습니다.`}
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: 14,
                  padding: '7px 18px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#059669',
                  color: '#FFFFFF',
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isEn ? 'Close' : '닫기'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                  {isEn ? 'Process Name *' : '요청 공정명 *'}
                </label>
                <input
                  type="text"
                  value={processName}
                  onChange={e => setProcessName(e.target.value)}
                  placeholder={isEn ? 'e.g., VCM Cracking, Cumene Process, LNG Liquefaction' : '예: VCM 열분해, 큐멘 합성, LNG 액화 공정 등'}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 12.5,
                    color: '#0F172A',
                    background: '#FFFFFF',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                    {isEn ? 'Key Feeds & Products' : '주요 원료 · 생성물'}
                  </label>
                  <input
                    type="text"
                    value={components}
                    onChange={e => setComponents(e.target.value)}
                    placeholder={isEn ? 'e.g., EDC -> VCM + HCl' : '예: EDC → VCM + HCl'}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 12.5,
                      color: '#0F172A',
                      background: '#FFFFFF',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                    {isEn ? 'Thermo / Operation Mode' : '열역학 · 운전 형태'}
                  </label>
                  <select
                    value={thermoMode}
                    onChange={e => setThermoMode(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 12.5,
                      color: '#0F172A',
                      background: '#FFFFFF',
                    }}
                  >
                    {THERMO_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                  {isEn ? 'Operating Conditions / Reference (Optional)' : '운전 조건 · 참고 문헌 · 요청사항 (선택)'}
                </label>
                <textarea
                  rows={3}
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder={
                    isEn
                      ? 'Target T/P, key unit operations (recycle, decanter, vacuum column), or textbook/paper reference...'
                      : '목표 온도/압력, 핵심 장치(리사이클, 진공증류, 배치 등) 또는 참고 문헌을 적어주시면 더 정확히 제작해 드립니다.'
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 12.5,
                    color: '#0F172A',
                    background: '#FFFFFF',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                    {isEn ? 'Email for Release Alert (Optional)' : '완성 시 알림 이메일 (선택)'}
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder="engineer@company.com"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 12,
                      color: '#0F172A',
                      background: '#FFFFFF',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>
                    {isEn ? 'Reference PFD / PDF (≤8MB)' : '참고 PFD / 자료 첨부 (≤8MB)'}
                  </label>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    style={{ fontSize: 11, color: '#475569', width: '100%' }}
                  />
                  {attachedFile && (
                    <div style={{ fontSize: 10.5, color: '#059669', marginTop: 2 }}>
                      ✓ {attachedFile.name} ({attachedFile.sizeKb} KB)
                    </div>
                  )}
                </div>
              </div>

              {errorMsg && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    color: '#B91C1C',
                    fontSize: 12,
                  }}
                >
                  {errorMsg}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    background: '#FFFFFF',
                    color: '#475569',
                    fontSize: 12.5,
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
                    padding: '8px 18px',
                    borderRadius: 6,
                    border: 'none',
                    background: canSubmit ? '#1D4ED8' : '#94A3B8',
                    color: '#FFFFFF',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                  }}
                >
                  {submitting
                    ? isEn ? 'Submitting...' : '접수 중...'
                    : isEn ? 'Submit Process Request' : '프로세스 예제 요청 접수'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
