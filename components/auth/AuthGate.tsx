'use client';

import React, { useState } from 'react';
import { loginWithPassword, registerUserAccount } from '@/lib/auth/authClient';
import { useAuth } from './AuthContext';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    loading,
    authenticated,
    registrationMode,
    authError,
    refreshAuthAndHydrate,
    handleLoginSuccess,
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 60%, #1E3A8A 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          color: '#E2E8F0',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: 16,
            padding: '28px 36px',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
            maxWidth: 420,
            width: '100%',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚗️</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#FFFFFF', marginBottom: 6 }}>
            ChemEng Studio
          </div>
          <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
            개인 워크스페이스 보안 연결 및 데이터 동기화 중...
          </div>
        </div>
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  const handleSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!username.trim() || !password) {
      setFormError('아이디와 비밀번호를 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password);
      await handleLoginSuccess();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!username.trim() || !password) {
      setFormError('사용할 아이디와 비밀번호를 입력하세요.');
      return;
    }
    if (registrationMode === 'invite_only' && !inviteCode.trim()) {
      setFormError('폐쇄형 테스트 기간입니다. 발급받은 초대코드를 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await registerUserAccount({
        username: username.trim(),
        password,
        display_name: displayName.trim() || username.trim(),
        invite_code: inviteCode.trim() || undefined,
      });
      if (res.status === 'active') {
        setFormSuccess(res.message || '가입이 완료되었습니다. 자동 로그인 중...');
        await loginWithPassword(username.trim(), password);
        await handleLoginSuccess();
      } else {
        setFormSuccess(
          res.message || '가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.'
        );
        setTab('login');
        setPassword('');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '회원가입 요청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const modeNotice =
    registrationMode === 'invite_only'
      ? '초대코드 전용 (폐쇄형 테스트)'
      : registrationMode === 'approval'
        ? '가입 후 관리자 승인제'
        : '자유 회원가입';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #09111E 0%, #0F2342 52%, #172554 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#FFFFFF',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 28px 70px rgba(0, 0, 0, 0.45)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
        }}
      >
        {/* Header Band */}
        <div
          style={{
            background: '#0F172A',
            color: '#FFFFFF',
            padding: '22px 26px 18px',
            borderBottom: '1px solid #1E293B',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: '#1D4ED8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                }}
              >
                ⚗️
              </span>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 900, letterSpacing: '-0.02em' }}>
                  ChemEng Studio
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                  화학공정 설계 · 열역학 시뮬레이션 플랫폼
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(59, 130, 246, 0.18)',
                color: '#93C5FD',
                border: '1px solid rgba(96, 165, 250, 0.35)',
                whiteSpace: 'nowrap',
              }}
            >
              {modeNotice}
            </span>
          </div>
        </div>

        {/* Mode Tabs */}
        <div style={{ display: 'flex', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setFormError(null);
            }}
            style={{
              flex: 1,
              padding: '11px 12px',
              border: 'none',
              borderBottom: tab === 'login' ? '2.5px solid #1D4ED8' : '2.5px solid transparent',
              background: tab === 'login' ? '#FFFFFF' : 'transparent',
              color: tab === 'login' ? '#1E3A8A' : '#64748B',
              fontSize: 12.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setFormError(null);
            }}
            style={{
              flex: 1,
              padding: '11px 12px',
              border: 'none',
              borderBottom: tab === 'register' ? '2.5px solid #1D4ED8' : '2.5px solid transparent',
              background: tab === 'register' ? '#FFFFFF' : 'transparent',
              color: tab === 'register' ? '#1E3A8A' : '#64748B',
              fontSize: 12.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {registrationMode === 'invite_only' ? '초대코드 가입' : '회원가입'}
          </button>
        </div>

        {/* Form Body */}
        <div style={{ padding: '22px 26px 24px' }}>
          {authError && (
            <div
              style={{
                marginBottom: 14,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#991B1B',
                fontSize: 11.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>⚠ {authError}</span>
              <button
                type="button"
                onClick={() => void refreshAuthAndHydrate()}
                style={{
                  padding: '3px 8px',
                  borderRadius: 5,
                  border: '1px solid #DC2626',
                  background: '#FFFFFF',
                  color: '#991B1B',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                재연결
              </button>
            </div>
          )}

          {formError && (
            <div
              style={{
                marginBottom: 14,
                padding: '9px 12px',
                borderRadius: 8,
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#B91C1C',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {formError}
            </div>
          )}

          {formSuccess && (
            <div
              style={{
                marginBottom: 14,
                padding: '9px 12px',
                borderRadius: 8,
                background: '#F0FDF4',
                border: '1px solid #86EFAC',
                color: '#166534',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {formSuccess}
            </div>
          )}

          {tab === 'login' ? (
            <form onSubmit={handleSubmitLogin} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>
                  사용자 아이디
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="아이디 입력"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    outline: 'none',
                    color: '#0F172A',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>
                  비밀번호
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    outline: 'none',
                    color: '#0F172A',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: 4,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: submitting ? '#94A3B8' : '#1D4ED8',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting ? '로그인 및 개인 환경 불러오는 중...' : '로그인'}
              </button>

              <div
                style={{
                  marginTop: 4,
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: 11,
                  color: '#475569',
                  lineHeight: 1.5,
                }}
              >
                각 사용자의 플로우시트·장치 설계·시뮬레이션 케이스는 개인 계정에만 독립 저장되며 타인에게 노출되지 않습니다.
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitRegister} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: '8px 11px',
                  borderRadius: 8,
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  fontSize: 11.2,
                  color: '#1E3A8A',
                  fontWeight: 600,
                }}
              >
                {registrationMode === 'invite_only'
                  ? '지정된 초청 코드 보유자 전용 폐쇄형 테스트 운영 중'
                  : registrationMode === 'approval'
                    ? '가입 신청 후 관리자 승인 시 접속 가능'
                    : '자유 회원가입 오픈 중 — 즉시 계정이 활성화됩니다'}
              </div>

              {registrationMode === 'invite_only' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    초대코드 (필수)
                  </label>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    placeholder="예: CHEM-INVITE-01"
                    style={{
                      width: '100%',
                      padding: '8px 11px',
                      borderRadius: 8,
                      border: '1.5px solid #93C5FD',
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, monospace',
                      color: '#0F172A',
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  아이디 (영문·숫자·밑줄)
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="예: engineer01"
                  style={{
                    width: '100%',
                    padding: '8px 11px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    color: '#0F172A',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  이름 / 소속
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="예: 홍길동 (공정기술팀)"
                  style={{
                    width: '100%',
                    padding: '8px 11px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    color: '#0F172A',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  비밀번호 (6자 이상)
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호 설정"
                  style={{
                    width: '100%',
                    padding: '8px 11px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    color: '#0F172A',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: 4,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: submitting ? '#94A3B8' : '#0F766E',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting
                  ? '계정 등록 처리 중...'
                  : registrationMode === 'approval'
                    ? '가입 승인 신청'
                    : '계정 등록 및 시작'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
