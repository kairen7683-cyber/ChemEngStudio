'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  getRememberMePreference,
  loginWithPassword,
  registerUserAccount,
  captureAndGetSignupSource,
  getStoredAutoInviteCode,
  setRememberMePreference,
} from '@/lib/auth/authClient';
import { PwaInstallButton } from '@/components/pwa/PwaRegistrar';
import LandingPage from '@/components/landing/LandingPage';
import { useUnitStore } from '@/lib/stores/unitStore';
import { useAuth } from './AuthContext';

function RememberMeOption({
  checked,
  onChange,
  isEn,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  isEn: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 11px',
        borderRadius: 8,
        background: checked ? '#EFF6FF' : '#F8FAFC',
        border: checked ? '1px solid #BFDBFE' : '1px solid #E2E8F0',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ width: 15, height: 15, accentColor: '#1D4ED8', cursor: 'pointer', margin: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>
          {isEn ? 'Keep me signed in' : '로그인 상태 유지'}
        </span>
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: checked ? '#1D4ED8' : '#64748B' }}>
        {checked
          ? isEn
            ? 'Stay signed in for 14 days'
            : '14일간 자동 로그인'
          : isEn
            ? 'Sign out when closed'
            : '창·앱 닫으면 로그아웃'}
      </span>
    </label>
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicLegalRoute =
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/refund' ||
    pathname === '/hub';
  const {
    loading,
    authenticated,
    isGuestDemo,
    enterGuestDemo,
    registrationMode,
    authError,
    refreshAuthAndHydrate,
    handleLoginSuccess,
  } = useAuth();
  const lang = useUnitStore(s => s.lang);
  const hydrateUnits = useUnitStore(s => s.hydrate);
  const isEn = lang === 'en';

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [guestAuthReason, setGuestAuthReason] = useState<string | null>(null);
  const [showLandingPreview, setShowLandingPreview] = useState(false);

  useEffect(() => {
    hydrateUnits();
  }, [hydrateUnits]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('landing') === '1') {
      setShowLandingPreview(true);
    }
    const onOpenLanding = () => setShowLandingPreview(true);
    const onPromptGuestAuth = (e: Event) => {
      const detail = (
        e as CustomEvent<{ reason?: string; defaultTab?: 'login' | 'register' }>
      ).detail;
      setGuestAuthReason(detail?.reason ?? null);
      setTab(detail?.defaultTab === 'login' ? 'login' : 'register');
      setFormError(null);
      setFormSuccess(null);
      setAuthModalOpen(true);
    };
    window.addEventListener('chemeng:open-landing', onOpenLanding);
    window.addEventListener('chemeng:prompt-guest-auth', onPromptGuestAuth);
    return () => {
      window.removeEventListener('chemeng:open-landing', onOpenLanding);
      window.removeEventListener('chemeng:prompt-guest-auth', onPromptGuestAuth);
    };
  }, []);

  const handleCloseLandingPreview = () => {
    setShowLandingPreview(false);
    if (typeof window !== 'undefined' && window.location.search.includes('landing=1')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('landing');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  };
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [plantProduct, setPlantProduct] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState<boolean>(true);

  useEffect(() => {
    setRememberMe(getRememberMePreference());
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('login') === '1') {
        setTab('login');
        setAuthModalOpen(true);
      } else if (params.get('register') === '1') {
        setTab('register');
        setAuthModalOpen(true);
      }
    } catch {
      // ignore URL parsing errors
    }
  }, []);

  useEffect(() => {
    if (!authModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAuthModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authModalOpen]);

  const handleOpenAuth = (defaultTab: 'login' | 'register' = 'login') => {
    setGuestAuthReason(null);
    setTab(defaultTab);
    setFormError(null);
    setFormSuccess(null);
    setAuthModalOpen(true);
  };

  const handleToggleRememberMe = (checked: boolean) => {
    setRememberMe(checked);
    setRememberMePreference(checked);
  };

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
          <img
            src="/icon-192-v2.png"
            alt="ChemPlant Studio"
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              margin: '0 auto 10px',
              display: 'block',
              objectFit: 'cover',
              border: '1px solid rgba(148, 163, 184, 0.35)',
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 900, color: '#FFFFFF', marginBottom: 6 }}>
            ChemPlant Studio
          </div>
          <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
            {isEn ? 'Connecting to your workspace...' : '개인 워크스페이스 보안 연결 및 데이터 동기화 중...'}
          </div>
        </div>
      </div>
    );
  }

  if (authenticated) {
    if (showLandingPreview) {
      return (
        <LandingPage
          onOpenAuth={() => handleCloseLandingPreview()}
          registrationMode={registrationMode}
          authError={null}
          isLoggedInPreview
          onReturnToWorkspace={handleCloseLandingPreview}
        />
      );
    }
    return <>{children}</>;
  }

  const handleSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!username.trim() || !password) {
      setFormError(
        isEn
          ? 'Please enter your email (or username) and password.'
          : '이메일(또는 아이디)과 비밀번호를 입력하세요.'
      );
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password, rememberMe);
      await handleLoginSuccess();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Sign in failed.'
            : '로그인에 실패했습니다.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();
    if (!trimmedEmail || !password) {
      setFormError(
        isEn
          ? 'Please enter your email address and password.'
          : '이메일 주소와 비밀번호를 입력하세요.'
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError(
        isEn ? 'Please enter a valid email address.' : '올바른 이메일 주소를 입력하세요.'
      );
      return;
    }
    if (password.length < 8) {
      setFormError(
        isEn ? 'Password must be at least 8 characters.' : '비밀번호는 8자 이상으로 설정하세요.'
      );
      return;
    }
    const autoInvite = getStoredAutoInviteCode();
    const resolvedInvite = inviteCode.trim() || autoInvite || undefined;
    if (registrationMode === 'invite_only' && !resolvedInvite) {
      setFormError(
        isEn
          ? 'Invite-only beta is active. Please enter your invite code.'
          : '폐쇄형 테스트 기간입니다. 발급받은 초대코드를 입력하세요.'
      );
      return;
    }
    const detectedSource = captureAndGetSignupSource();
    setSubmitting(true);
    try {
      const res = await registerUserAccount({
        email: trimmedEmail,
        username: normalizedEmail,
        password,
        display_name: displayName.trim() || normalizedEmail.split('@')[0] || normalizedEmail,
        plant_product: plantProduct.trim(),
        invite_code: resolvedInvite,
        signup_source: detectedSource,
        remember_me: rememberMe,
      });
      if (res.status === 'active') {
        setFormSuccess(
          res.message ||
            (isEn ? 'Account created. Signing you in...' : '가입이 완료되었습니다. 자동 로그인 중...')
        );
        await loginWithPassword(normalizedEmail, password, rememberMe);
        await handleLoginSuccess();
      } else {
        setFormSuccess(
          res.message ||
            (isEn
              ? 'Registration submitted. You can sign in once an admin approves your account.'
              : '가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.')
        );
        setUsername(normalizedEmail);
        setTab('login');
        setPassword('');
      }
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : isEn
            ? 'Registration failed.'
            : '회원가입 요청에 실패했습니다.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modeNotice =
    registrationMode === 'invite_only'
      ? isEn
        ? 'Invite-Only Beta'
        : '초대코드 전용 (폐쇄형 테스트)'
      : registrationMode === 'approval'
        ? isEn
          ? 'Admin Approval'
          : '가입 후 관리자 승인제'
        : isEn
          ? 'Open Registration'
          : '자유 회원가입';

  if (isPublicLegalRoute) {
    return <>{children}</>;
  }

  return (
    <>
      {isGuestDemo && !showLandingPreview ? (
        children
      ) : (
        <LandingPage
          onOpenAuth={handleOpenAuth}
          onTryDemo={() => {
            handleCloseLandingPreview();
            enterGuestDemo();
          }}
          registrationMode={registrationMode}
          authError={authError}
        />
      )}

      {authModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ChemPlant Studio Sign In"
          onClick={() => setAuthModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '92vh',
              overflowY: 'auto',
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 28px 70px rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
            }}
          >
            {/* Header Band */}
            <div
              style={{
                background: '#0F172A',
                color: '#FFFFFF',
                padding: '20px 22px 16px',
                borderBottom: '1px solid #1E293B',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <img
                    src="/icon-192-v2.png"
                    alt="ChemPlant Studio"
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      objectFit: 'cover',
                      flexShrink: 0,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 16.5, fontWeight: 900, letterSpacing: '-0.02em' }}>
                      ChemPlant Studio
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                      {isEn
                        ? 'Chemical Process Design & Simulation Platform'
                        : '화학공정 설계 · 열역학 시뮬레이션 플랫폼'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: 'rgba(59, 130, 246, 0.18)',
                      color: '#93C5FD',
                      border: '1px solid rgba(96, 165, 250, 0.35)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {modeNotice}
                  </span>
                  <button
                    type="button"
                    aria-label={isEn ? 'Close' : '닫기'}
                    onClick={() => setAuthModalOpen(false)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      border: '1px solid #334155',
                      background: '#1E293B',
                      color: '#E2E8F0',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
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
            {isEn ? 'Sign In' : '로그인'}
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
            {registrationMode === 'invite_only'
              ? isEn
                ? 'Invite Sign Up'
                : '초대코드 가입'
              : isEn
                ? 'Create Account'
                : '회원가입'}
          </button>
        </div>

        {/* Form Body */}
        <div style={{ padding: '22px 26px 24px' }}>
          {guestAuthReason && (
            <div
              style={{
                marginBottom: 14,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#F1F5F9',
                border: '1px solid #CBD5E1',
                borderLeft: '3px solid #1E3A8A',
                color: '#1E293B',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.45,
              }}
            >
              {guestAuthReason}
            </div>
          )}

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
              <span>{authError}</span>
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
                {isEn ? 'Retry' : '재연결'}
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
                  {isEn ? 'Email or Username' : '이메일 또는 아이디'}
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder={isEn ? 'name@company.com or username' : 'name@company.com 또는 아이디'}
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
                  {isEn ? 'Password' : '비밀번호'}
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isEn ? 'Enter your password' : '비밀번호 입력'}
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

              <RememberMeOption checked={rememberMe} onChange={handleToggleRememberMe} isEn={isEn} />

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
                {submitting
                  ? isEn
                    ? 'Signing in and loading workspace...'
                    : '로그인 및 개인 환경 불러오는 중...'
                  : isEn
                    ? 'Sign In'
                    : '로그인'}
              </button>
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
                  ? isEn
                    ? 'Invite-Only Beta — an invite code is required to register.'
                    : '지정된 초청 코드 보유자 전용 폐쇄형 테스트 운영 중'
                  : registrationMode === 'approval'
                    ? isEn
                      ? 'Admin Approval — your account will be activated after review.'
                      : '가입 신청 후 관리자 승인 시 접속 가능'
                    : isEn
                      ? 'Open Beta (Free Sign-Up) — No invite code required. Free access includes the full flowsheet simulator, 4 free Process Examples, 6 unit design tools, cloud save, Excel export, and 10 daily AI auto-fixes. Pro industrial examples (🔒) will be part of paid plans.'
                      : '오픈 베타 기간 무료 회원가입 — 초대코드 없이 즉시 활성화됩니다. 공정 시뮬레이터 · 무료 프로세스 예제 4종 · 6대 장치 설계 · 클라우드 저장 · 엑셀 내보내기 · 일일 AI 자동보정(10회)을 무료로 이용할 수 있으며, Pro 전용 산업 공정(🔒)은 추후 유료 플랜에 포함됩니다.'}
              </div>

              {registrationMode === 'invite_only' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    {isEn ? 'Invite Code (Required)' : '초대코드 (필수)'}
                  </label>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    placeholder={isEn ? 'e.g. CHEM-INVITE-01' : '예: CHEM-INVITE-01'}
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
                  {isEn ? 'Email' : '이메일 주소 (Email)'}
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@company.com"
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
                  {isEn ? 'Industry / Process Field' : '담당 업무 · 관심 공정'}{' '}
                  <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={plantProduct}
                  onChange={e => setPlantProduct(e.target.value)}
                  placeholder={
                    isEn
                      ? 'e.g. EPC process design, distillation/HEX, fine chemicals, battery materials'
                      : '예: EPC 공정설계, 증류탑·열교환기, 정밀화학, 2차전지 소재 등'
                  }
                  style={{
                    width: '100%',
                    padding: '8px 11px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 12.5,
                    color: '#0F172A',
                  }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                  {(isEn
                    ? [
                        'Petrochem / Refining',
                        'Fine Chemicals',
                        'Chlor-Alkali / Inorganic',
                        'Semiconductor / Gas',
                        'Battery Materials',
                        'EPC / Equipment',
                        'R&D / Academia',
                      ]
                    : [
                        '석유화학·정유',
                        '정밀화학',
                        '전해·무기화학',
                        '반도체·특수가스',
                        '2차전지 소재',
                        'EPC·설비설계',
                        '연구소·학계',
                      ]
                  ).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setPlantProduct(tag)}
                      style={{
                        padding: '2px 7px',
                        borderRadius: 4,
                        border: plantProduct === tag ? '1px solid #1E3A8A' : '1px solid #CBD5E1',
                        background: plantProduct === tag ? '#EFF6FF' : '#F8FAFC',
                        color: plantProduct === tag ? '#1E3A8A' : '#475569',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  {isEn ? 'Password (8+ characters)' : '비밀번호 (8자 이상)'}
                </label>
                <input
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isEn ? 'At least 8 characters' : '8자 이상 비밀번호 설정'}
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

              {registrationMode !== 'approval' && (
                <RememberMeOption checked={rememberMe} onChange={handleToggleRememberMe} isEn={isEn} />
              )}

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
                  ? isEn
                    ? 'Creating account...'
                    : '계정 등록 처리 중...'
                  : registrationMode === 'approval'
                    ? isEn
                      ? 'Request Access'
                      : '가입 승인 신청'
                    : isEn
                      ? 'Create Account & Launch'
                      : '계정 등록 및 시작'}
              </button>
            </form>
          )}

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                padding: '7px 10px',
                borderRadius: 7,
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: 10.8,
                color: '#64748B',
                lineHeight: 1.45,
              }}
            >
              {isEn
                ? 'Supports 1 desktop + 1 mobile active session per account (older sessions on the same device type sign out automatically).'
                : '계정당 PC 1대 + 모바일 1대 동시 로그인 지원 (초과 시 기존 동일 기기 자동 로그아웃)'}
            </div>
            <PwaInstallButton variant="login" />
            <div
              style={{
                padding: '9px 11px',
                borderRadius: 8,
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: 11,
                color: '#475569',
                lineHeight: 1.5,
              }}
            >
              {isEn
                ? 'All flowsheets, equipment designs, and simulation cases are stored privately in your isolated workspace.'
                : '각 사용자의 플로우시트·장치 설계·시뮬레이션 케이스는 개인 계정에만 독립 저장되며 타인에게 노출되지 않습니다.'}
            </div>
          </div>
        </div>
          </div>
        </div>
      )}
    </>
  );
}
