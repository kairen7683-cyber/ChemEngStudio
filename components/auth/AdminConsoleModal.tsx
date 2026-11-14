'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  type AdminUserSummary,
  type InviteCodeItem,
  type RegistrationMode,
  adminCreateInviteCode,
  adminCreateUser,
  adminDeleteUser,
  adminFetchOverview,
  adminToggleInviteCode,
  adminUpdateSettings,
  adminUpdateUser,
  changeMyPassword,
} from '@/lib/auth/authClient';
import { useAuth } from './AuthContext';

export function HeaderUserControls() {
  const {
    user,
    syncStatus,
    syncError,
    localDevBypass,
    openAccountModal,
    handleLogout,
    forceSyncNow,
  } = useAuth();

  if (!user) return null;

  const syncBadge = (() => {
    if (localDevBypass) {
      return { text: '로컬 개발', bg: '#1E293B', color: '#94A3B8', border: '#334155' };
    }
    if (syncStatus === 'saving') {
      return { text: '⟳ 저장중', bg: '#1E3A8A', color: '#DBEAFE', border: '#3B82F6' };
    }
    if (syncStatus === 'error') {
      return { text: '⚠ 동기화 재시도', bg: '#7F1D1D', color: '#FEE2E2', border: '#EF4444' };
    }
    return { text: '☁ 저장됨', bg: '#064E3B', color: '#A7F3D0', border: '#10B981' };
  })();

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => void forceSyncNow()}
        title={syncError ? `동기화 오류: ${syncError}` : '클릭 시 현재 작업 상태를 서버에 즉시 저장합니다'}
        style={{
          padding: '3px 7px',
          borderRadius: 6,
          border: `1px solid ${syncBadge.border}`,
          background: syncBadge.bg,
          color: syncBadge.color,
          fontSize: 10,
          fontWeight: 800,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {syncBadge.text}
      </button>

      <button
        type="button"
        onClick={() => openAccountModal('profile')}
        title="내 계정 정보 및 비밀번호 변경"
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          border: '1px solid #334E68',
          background: '#1A2F44',
          color: '#F1F5F9',
          fontSize: 10.5,
          fontWeight: 800,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {user.role === 'admin' ? '👑 ' : '👤 '}
        {user.display_name || user.username}
      </button>

      {user.role === 'admin' && (
        <button
          type="button"
          onClick={() => openAccountModal('admin')}
          title="관리자 콘솔 (회원가입 모드·초대코드·계정 관리)"
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid #F59E0B',
            background: '#78350F',
            color: '#FEF3C7',
            fontSize: 10.5,
            fontWeight: 800,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          관리자
        </button>
      )}

      {!localDevBypass && (
        <button
          type="button"
          onClick={() => void handleLogout()}
          title="안전하게 로그아웃하고 로컬 캐시를 비웁니다"
          style={{
            padding: '3px 7px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: '#0F172A',
            color: '#CBD5E1',
            fontSize: 10.2,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          로그아웃
        </button>
      )}
    </div>
  );
}

export default function AdminConsoleModal() {
  const {
    user,
    accountModalOpen,
    accountModalTab,
    openAccountModal,
    closeAccountModal,
    forceSyncNow,
    refreshAuthAndHydrate,
  } = useAuth();

  // 내 비밀번호 변경 상태
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 관리자 콘솔 상태
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMsg, setAdminMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [regMode, setRegMode] = useState<RegistrationMode>('invite_only');
  const [aiLimit, setAiLimit] = useState(30);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [invites, setInvites] = useState<InviteCodeItem[]>([]);

  // 초대코드 생성 폼
  const [invMemo, setInvMemo] = useState('');
  const [invMaxUses, setInvMaxUses] = useState(5);
  const [invExpDays, setInvExpDays] = useState(30);

  // 신규 사용자 직접 생성 폼
  const [newUsername, setNewUsername] = useState('');
  const [newDispName, setNewDispName] = useState('');
  const [newUserPw, setNewUserPw] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');

  const loadAdminOverview = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setAdminLoading(true);
    try {
      const ov = await adminFetchOverview();
      setRegMode(ov.registration_mode);
      setAiLimit(ov.daily_ai_limit);
      setHasGeminiKey(ov.has_gemini_key);
      setUsers(ov.users);
      setInvites(ov.invites);
    } catch (err) {
      setAdminMsg({
        type: 'err',
        text: err instanceof Error ? err.message : '관리자 정보를 불러오지 못했습니다.',
      });
    } finally {
      setAdminLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (accountModalOpen && accountModalTab === 'admin' && user?.role === 'admin') {
      void loadAdminOverview();
    }
  }, [accountModalOpen, accountModalTab, user, loadAdminOverview]);

  if (!accountModalOpen || !user) return null;

  const isAdmin = user.role === 'admin';

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    try {
      await changeMyPassword(curPw, newPw);
      setCurPw('');
      setNewPw('');
      setProfileMsg({ type: 'ok', text: '비밀번호가 성공적으로 변경되었습니다.' });
    } catch (err) {
      setProfileMsg({
        type: 'err',
        text: err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.',
      });
    }
  };

  const handleManualSync = async () => {
    setProfileMsg(null);
    try {
      const count = await forceSyncNow();
      setProfileMsg({ type: 'ok', text: `클라우드 서버 동기화 완료 (${count}개 작업공간 항목)` });
    } catch (err) {
      setProfileMsg({
        type: 'err',
        text: err instanceof Error ? err.message : '동기화 중 오류가 발생했습니다.',
      });
    }
  };

  const handleModeChange = async (mode: RegistrationMode) => {
    setAdminMsg(null);
    try {
      await adminUpdateSettings({ registration_mode: mode });
      setRegMode(mode);
      setAdminMsg({ type: 'ok', text: `가입 운영 모드가 [${mode}]로 변경되었습니다.` });
      await refreshAuthAndHydrate();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '변경 실패' });
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminMsg(null);
    try {
      const patch: { daily_ai_limit: number; gemini_api_key?: string } = {
        daily_ai_limit: Math.max(0, Number(aiLimit) || 0),
      };
      if (newGeminiKey.trim()) {
        patch.gemini_api_key = newGeminiKey.trim();
      }
      await adminUpdateSettings(patch);
      setNewGeminiKey('');
      setAdminMsg({ type: 'ok', text: 'AI 호출 한도 및 서버 API 설정이 저장되었습니다.' });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : 'AI 설정 저장 실패' });
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminMsg(null);
    try {
      const res = await adminCreateInviteCode({
        memo: invMemo.trim() || '지인 테스트 초청',
        max_uses: Math.max(1, Number(invMaxUses) || 1),
        expires_days: invExpDays > 0 ? Number(invExpDays) : null,
      });
      setInvMemo('');
      setAdminMsg({ type: 'ok', text: `새 초대코드 [${res.code}] 발급 완료` });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '초대코드 생성 실패' });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminMsg(null);
    if (!newUsername.trim() || !newUserPw) {
      setAdminMsg({ type: 'err', text: '생성할 아이디와 비밀번호를 입력하세요.' });
      return;
    }
    try {
      await adminCreateUser({
        username: newUsername.trim(),
        display_name: newDispName.trim() || newUsername.trim(),
        password: newUserPw,
        role: newUserRole,
      });
      setNewUsername('');
      setNewDispName('');
      setNewUserPw('');
      setAdminMsg({ type: 'ok', text: `계정 [${newUsername.trim()}] 생성 완료` });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '사용자 생성 실패' });
    }
  };

  const handleResetUserPw = async (u: AdminUserSummary) => {
    const pw = window.prompt(`[${u.username}] 계정의 새 임시 비밀번호를 입력하세요 (6자 이상):`);
    if (!pw) return;
    try {
      await adminUpdateUser(u.id, { new_password: pw });
      setAdminMsg({ type: 'ok', text: `[${u.username}] 비밀번호 재설정 완료` });
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '비밀번호 재설정 실패' });
    }
  };

  const handleResetWorkspace = async (u: AdminUserSummary) => {
    if (!window.confirm(`[${u.username}] 사용자의 저장된 모든 시뮬레이션 데이터를 서버에서 초기화할까요?`)) {
      return;
    }
    try {
      await adminUpdateUser(u.id, { reset_workspace: true });
      setAdminMsg({ type: 'ok', text: `[${u.username}] 워크스페이스 데이터 초기화 완료` });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '초기화 실패' });
    }
  };

  const handleDeleteUser = async (u: AdminUserSummary) => {
    if (!window.confirm(`[${u.username}] 계정을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    try {
      await adminDeleteUser(u.id);
      setAdminMsg({ type: 'ok', text: `[${u.username}] 계정이 삭제되었습니다.` });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '삭제 실패' });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={closeAccountModal}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: accountModalTab === 'admin' ? 920 : 520,
          maxHeight: '90vh',
          background: '#FFFFFF',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            background: '#0F172A',
            color: '#FFFFFF',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 900 }}>
              {accountModalTab === 'admin' ? '👑 관리자 콘솔' : '🔑 내 계정 및 동기화'}
            </span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => openAccountModal('profile')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: accountModalTab === 'profile' ? '#2563EB' : '#1E293B',
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                내 계정
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => openAccountModal('admin')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: accountModalTab === 'admin' ? '#D97706' : '#1E293B',
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  👑 시스템 관리자
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={closeAccountModal}
            style={{
              border: '1px solid #334155',
              background: '#1E293B',
              color: '#E2E8F0',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            닫기 ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {accountModalTab === 'profile' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {profileMsg && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: profileMsg.type === 'ok' ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${profileMsg.type === 'ok' ? '#86EFAC' : '#FCA5A5'}`,
                    color: profileMsg.type === 'ok' ? '#166534' : '#991B1B',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {profileMsg.text}
                </div>
              )}

              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                    {user.display_name} ({user.username})
                  </div>
                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                    권한: <b>{user.role === 'admin' ? '시스템 관리자' : '엔지니어 사용자'}</b> · 상태: <b>{user.status}</b>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleManualSync()}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 7,
                    border: '1px solid #0284C7',
                    background: '#0369A1',
                    color: '#FFFFFF',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ☁ 지금 클라우드 백업
                </button>
              </div>

              <form
                onSubmit={handleSavePassword}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>
                  비밀번호 변경
                </div>
                <input
                  type="password"
                  placeholder="현재 비밀번호"
                  value={curPw}
                  onChange={e => setCurPw(e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 12.5 }}
                />
                <input
                  type="password"
                  placeholder="새 비밀번호 (6자 이상)"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 12.5 }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 7,
                    border: 'none',
                    background: '#1E3A8A',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  비밀번호 저장
                </button>
              </form>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {adminMsg && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: adminMsg.type === 'ok' ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${adminMsg.type === 'ok' ? '#86EFAC' : '#FCA5A5'}`,
                    color: adminMsg.type === 'ok' ? '#166534' : '#991B1B',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {adminMsg.text}
                </div>
              )}

              {/* 1. 가입 모드 원클릭 전환 & AI 설정 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                <div style={{ padding: 13, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>
                    1. 가입 정책 원클릭 전환
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(
                      [
                        { id: 'invite_only', label: '초대코드 전용 (폐쇄형 테스트)' },
                        { id: 'approval', label: '가입 신청 → 관리자 승인제' },
                        { id: 'open', label: '자유 회원가입 오픈' },
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => void handleModeChange(opt.id)}
                        style={{
                          textAlign: 'left',
                          padding: '7px 10px',
                          borderRadius: 7,
                          border: regMode === opt.id ? '1.5px solid #1D4ED8' : '1px solid #CBD5E1',
                          background: regMode === opt.id ? '#DBEAFE' : '#FFFFFF',
                          color: regMode === opt.id ? '#1E3A8A' : '#334155',
                          fontSize: 11.5,
                          fontWeight: regMode === opt.id ? 900 : 600,
                          cursor: 'pointer',
                        }}
                      >
                        {regMode === opt.id ? '● ' : '○ '}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <form
                  onSubmit={handleSaveAiSettings}
                  style={{ padding: 13, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                    2. AI 호출 쿼터 & 서버 Gemini 키 ({hasGeminiKey ? '등록됨 ✓' : '미등록'})
                  </div>
                  <label style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>
                    사용자 일일 AI 최대 호출 횟수 (0이면 AI 비활성):
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={aiLimit}
                      onChange={e => setAiLimit(Number(e.target.value))}
                      style={{ marginLeft: 8, width: 72, padding: '4px 6px', borderRadius: 5, border: '1px solid #CBD5E1' }}
                    />
                  </label>
                  <input
                    type="password"
                    value={newGeminiKey}
                    onChange={e => setNewGeminiKey(e.target.value)}
                    placeholder={hasGeminiKey ? '새 Gemini Key 입력 시 교체 (비우면 유지)' : '서버 공용 Gemini API Key 입력'}
                    style={{ padding: '7px 9px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#0F766E',
                      color: '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      alignSelf: 'flex-start',
                    }}
                  >
                    AI 설정 저장
                  </button>
                </form>
              </div>

              {/* 2. 초대코드 발급 및 목록 */}
              <div style={{ padding: 13, borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>
                  3. 초대코드 발급 및 관리
                </div>
                <form
                  onSubmit={handleCreateInvite}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}
                >
                  <input
                    type="text"
                    value={invMemo}
                    onChange={e => setInvMemo(e.target.value)}
                    placeholder="메모 (예: 기술팀 김대리)"
                    style={{ flex: '1 1 160px', padding: '6px 9px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={invMaxUses}
                    onChange={e => setInvMaxUses(Number(e.target.value))}
                    title="최대 사용 횟수"
                    style={{ width: 68, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <span style={{ fontSize: 11, color: '#64748B' }}>회 / 유효</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={invExpDays}
                    onChange={e => setInvExpDays(Number(e.target.value))}
                    title="유효 일수 (0은 무기한)"
                    style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <span style={{ fontSize: 11, color: '#64748B' }}>일</span>
                  <button
                    type="submit"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#1D4ED8',
                      color: '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    + 초대코드 생성
                  </button>
                </form>

                <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 7 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.2 }}>
                    <thead style={{ background: '#F8FAFC', color: '#475569' }}>
                      <tr>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>코드</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>메모</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>사용</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>조작</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map(inv => (
                        <tr key={inv.code} style={{ borderTop: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>
                            {inv.code}
                          </td>
                          <td style={{ padding: '5px 8px' }}>{inv.memo || '-'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {inv.used_count} / {inv.max_uses}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <span style={{ color: inv.is_active ? '#16A34A' : '#94A3B8', fontWeight: 700 }}>
                              {inv.is_active ? '활성' : '비활성'}
                            </span>
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(inv.code);
                                setAdminMsg({ type: 'ok', text: `[${inv.code}] 클립보드에 복사되었습니다.` });
                              }}
                              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 10.5, cursor: 'pointer' }}
                            >
                              복사
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await adminToggleInviteCode(inv.code, !inv.is_active);
                                await loadAdminOverview();
                              }}
                              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#F8FAFC', fontSize: 10.5, cursor: 'pointer' }}
                            >
                              {inv.is_active ? '정지' : '활성'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. 사용자 계정 직접 생성 및 목록 */}
              <div style={{ padding: 13, borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                    4. 사용자 계정 & 워크스페이스 관리 ({users.length}명)
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadAdminOverview()}
                    disabled={adminLoading}
                    style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #CBD5E1', background: '#F8FAFC', fontSize: 10.5, cursor: 'pointer' }}
                  >
                    {adminLoading ? '갱신 중...' : '새로고침'}
                  </button>
                </div>

                <form
                  onSubmit={handleCreateUser}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}
                >
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="아이디"
                    style={{ width: 120, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    value={newDispName}
                    onChange={e => setNewDispName(e.target.value)}
                    placeholder="표시 이름"
                    style={{ width: 130, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <input
                    type="password"
                    value={newUserPw}
                    onChange={e => setNewUserPw(e.target.value)}
                    placeholder="초기 비밀번호"
                    style={{ width: 130, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <select
                    value={newUserRole}
                    onChange={e => setNewUserRole(e.target.value as 'user' | 'admin')}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  >
                    <option value="user">일반 사용자</option>
                    <option value="admin">관리자</option>
                  </select>
                  <button
                    type="submit"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#0F172A',
                      color: '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    + 계정 직접 발급
                  </button>
                </form>

                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 7 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead style={{ background: '#F8FAFC', color: '#475569' }}>
                      <tr>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>아이디 (이름)</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>권한</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>저장 데이터</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <b>{u.username}</b> <span style={{ color: '#64748B' }}>({u.display_name})</span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {u.role === 'admin' ? '👑 관리자' : '사용자'}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontWeight: 700,
                                background:
                                  u.status === 'active'
                                    ? '#DCFCE7'
                                    : u.status === 'pending'
                                      ? '#FEF3C7'
                                      : '#FEE2E2',
                                color:
                                  u.status === 'active'
                                    ? '#166534'
                                    : u.status === 'pending'
                                      ? '#92400E'
                                      : '#991B1B',
                              }}
                            >
                              {u.status}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>
                            {u.workspace_count}키 / {Math.round(u.workspace_bytes / 1024)}KB
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                            {u.status === 'pending' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await adminUpdateUser(u.id, { status: 'active' });
                                  await loadAdminOverview();
                                }}
                                style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: '#16A34A', color: '#FFFFFF', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                              >
                                승인
                              </button>
                            )}
                            {u.id !== user.id && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await adminUpdateUser(u.id, {
                                    status: u.status === 'active' ? 'disabled' : 'active',
                                  });
                                  await loadAdminOverview();
                                }}
                                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 10.5, cursor: 'pointer' }}
                              >
                                {u.status === 'active' ? '정지' : '복구'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleResetUserPw(u)}
                              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: 10.5, cursor: 'pointer' }}
                            >
                              비번초기화
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResetWorkspace(u)}
                              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #FDBA74', background: '#FFF7ED', color: '#9A3412', fontSize: 10.5, cursor: 'pointer' }}
                            >
                              데이터초기화
                            </button>
                            {u.id !== user.id && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteUser(u)}
                                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C', fontSize: 10.5, cursor: 'pointer' }}
                              >
                                삭제
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
