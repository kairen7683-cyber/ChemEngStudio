'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  type ActiveDeviceSession,
  type AdminUserSummary,
  type BetaFeedbackItem,
  type FeedbackCategory,
  type FeedbackStatus,
  type InviteCodeItem,
  type RegistrationMode,
  adminCreateInviteCode,
  adminCreateUser,
  adminDeleteUser,
  adminFetchOverview,
  adminListFeedback,
  adminRevokeUserSessions,
  adminToggleInviteCode,
  adminUpdateFeedback,
  adminUpdateSettings,
  adminUpdateUser,
  changeMyPassword,
  fetchMySessions,
  revokeMySession,
} from '@/lib/auth/authClient';
import { PwaInstallButton } from '@/components/pwa/PwaRegistrar';
import { PLANT_REGISTRY, isSimulatorOnlyUser } from '@/lib/plantRegistry';
import { UserOutlineIcon } from '@/components/ui/EngIcons';
import { useAuth } from './AuthContext';

const SELECTABLE_PLANTS = PLANT_REGISTRY.filter(p => !p.hiddenFromSelector && !p.isSandbox);

type PlantPermissionScope = 'simulator_only' | 'all' | 'custom';

const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, { label: string; bg: string; border: string; color: string }> = {
  bug: { label: '버그 신고', bg: '#FEF2F2', border: '#FCA5A5', color: '#991B1B' },
  calc: { label: '계산·수식', bg: '#EFF6FF', border: '#93C5FD', color: '#1E40AF' },
  feature: { label: '기능 제안', bg: '#F0FDF4', border: '#86EFAC', color: '#166534' },
  ux: { label: 'UI·사용성', bg: '#F8FAFC', border: '#CBD5E1', color: '#334155' },
};

const FEEDBACK_STATUS_OPTIONS: Array<{ value: FeedbackStatus; label: string }> = [
  { value: 'new', label: '신규' },
  { value: 'in_progress', label: '진행' },
  { value: 'done', label: '완료' },
];

function formatSessionTime(iso?: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatAllowedPlantCodes(user: { role?: string; allowed_plants?: string[] | null }): string[] {
  if (user.role === 'admin') return ['전체'];
  if (!Array.isArray(user.allowed_plants) || user.allowed_plants.length === 0) return ['전체'];
  if (user.allowed_plants.includes('*')) return ['전체'];
  if (user.allowed_plants.includes('simulator_only')) return ['시뮬레이터 전용'];
  return user.allowed_plants.map(pid => PLANT_REGISTRY.find(p => p.id === pid)?.code ?? pid);
}

function PlantPermissionPicker({
  scope,
  selectedPlants,
  onChangeScope,
  onTogglePlant,
  disabled,
  disabledReason,
}: {
  scope: PlantPermissionScope;
  selectedPlants: string[];
  onChangeScope: (next: PlantPermissionScope) => void;
  onTogglePlant: (plantId: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 7,
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: 11.2 }}>
        <span style={{ fontWeight: 800, color: '#0F172A' }}>공장 접근 권한:</span>
        {disabled ? (
          <span style={{ color: '#0F766E', fontWeight: 700 }}>{disabledReason || '전체 공장 허용'}</span>
        ) : (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: scope === 'simulator_only' ? 800 : 600, color: scope === 'simulator_only' ? '#B45309' : '#334155' }}>
              <input
                type="radio"
                checked={scope === 'simulator_only'}
                onChange={() => onChangeScope('simulator_only')}
                style={{ margin: 0, cursor: 'pointer' }}
              />
              <span>시뮬레이터 전용 · 예제 비공개 (베타 기본)</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: scope === 'all' ? 800 : 600, color: scope === 'all' ? '#1D4ED8' : '#334155' }}>
              <input
                type="radio"
                checked={scope === 'all'}
                onChange={() => onChangeScope('all')}
                style={{ margin: 0, cursor: 'pointer' }}
              />
              <span>전체 공장</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: scope === 'custom' ? 800 : 600, color: scope === 'custom' ? '#1D4ED8' : '#334155' }}>
              <input
                type="radio"
                checked={scope === 'custom'}
                onChange={() => onChangeScope('custom')}
                style={{ margin: 0, cursor: 'pointer' }}
              />
              <span>특정 공장 선택</span>
            </label>
          </>
        )}
      </div>

      {!disabled && scope === 'custom' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
          {SELECTABLE_PLANTS.map(p => {
            const checked = selectedPlants.includes(p.id);
            return (
              <label
                key={p.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: checked ? '1.5px solid #2563EB' : '1px solid #CBD5E1',
                  background: checked ? '#EFF6FF' : '#FFFFFF',
                  color: checked ? '#1E3A8A' : '#334155',
                  fontSize: 11,
                  fontWeight: checked ? 800 : 600,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onTogglePlant(p.id)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <span>{p.code}</span>
                <span style={{ color: '#64748B', fontWeight: 600 }}>({p.shortLabel})</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below handles non-HTTPS / permission-restricted contexts
    }
  }
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function generateStrongPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const buf = new Uint32Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length; i++) {
      suffix += chars[buf[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 6; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return `Chem!${suffix}`;
}

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
      return { text: '로컬 개발', dot: '#64748B' };
    }
    if (syncStatus === 'saving') {
      return { text: '저장중', dot: '#60A5FA' };
    }
    if (syncStatus === 'error') {
      return { text: '동기화 재시도', dot: '#EF4444' };
    }
    return { text: '저장됨', dot: '#10B981' };
  })();

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <PwaInstallButton variant="header" />
      <button
        type="button"
        onClick={() => void forceSyncNow()}
        title={syncError ? `동기화 오류: ${syncError}` : '클릭 시 현재 작업 상태를 서버에 즉시 저장합니다'}
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#1E293B',
          color: '#E2E8F0',
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: syncBadge.dot,
            flexShrink: 0,
          }}
        />
        <span>{syncBadge.text}</span>
      </button>

      <button
        type="button"
        onClick={() => openAccountModal('profile')}
        title="내 계정 정보 및 비밀번호 변경"
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#1E293B',
          color: '#E2E8F0',
          fontSize: 10.5,
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <UserOutlineIcon size={12} />
        <span>{user.display_name || user.username}</span>
      </button>

      {user.role === 'admin' && (
        <button
          type="button"
          onClick={() => openAccountModal('admin')}
          title="관리자 콘솔 (회원가입 모드·초대코드·계정 관리)"
          style={{
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid #334155',
            background: '#1E293B',
            color: '#E2E8F0',
            fontSize: 10.5,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          계정관리
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
            border: '1px solid #334155',
            background: '#1E293B',
            color: '#E2E8F0',
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

  // 내 비밀번호 변경 상태 & 활성 기기 목록
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [mySessions, setMySessions] = useState<ActiveDeviceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  // 관리자 콘솔 상태
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMsg, setAdminMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [regMode, setRegMode] = useState<RegistrationMode>('invite_only');
  const [aiLimit, setAiLimit] = useState(30);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [invites, setInvites] = useState<InviteCodeItem[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<BetaFeedbackItem[]>([]);
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState<number | null>(null);

  // 초대코드 생성 폼
  const [invMemo, setInvMemo] = useState('');
  const [invMaxUses, setInvMaxUses] = useState(5);
  const [invExpDays, setInvExpDays] = useState(30);

  // 신규 사용자 직접 생성 폼 & 발급된 비밀번호 복사 배너
  const [newUsername, setNewUsername] = useState('');
  const [newDispName, setNewDispName] = useState('');
  const [newUserPw, setNewUserPw] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');
  const [newUserPlantScope, setNewUserPlantScope] = useState<PlantPermissionScope>('simulator_only');
  const [newUserAllowedPlants, setNewUserAllowedPlants] = useState<string[]>([]);
  const [editingPlantsUser, setEditingPlantsUser] = useState<AdminUserSummary | null>(null);
  const [editPlantScope, setEditPlantScope] = useState<PlantPermissionScope>('simulator_only');
  const [editAllowedPlants, setEditAllowedPlants] = useState<string[]>([]);
  const [showCreateUserPw, setShowCreateUserPw] = useState(true);
  const [lastIssuedCreds, setLastIssuedCreds] = useState<{
    username: string;
    password: string;
    mode: '생성' | '재설정';
  } | null>(null);

  const loadMySessions = useCallback(async () => {
    if (!user) return;
    setSessionsLoading(true);
    try {
      const list = await fetchMySessions();
      setMySessions(Array.isArray(list) ? list : []);
    } catch {
      setMySessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [user]);

  const loadAdminOverview = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setAdminLoading(true);
    try {
      const [ov, fb] = await Promise.all([
        adminFetchOverview(),
        adminListFeedback().catch(() => [] as BetaFeedbackItem[]),
      ]);
      setRegMode(ov.registration_mode);
      setAiLimit(ov.daily_ai_limit);
      setHasGeminiKey(ov.has_gemini_key);
      setUsers(ov.users);
      setInvites(ov.invites);
      setFeedbackItems(fb);
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

  useEffect(() => {
    if (accountModalOpen && accountModalTab === 'profile' && user) {
      void loadMySessions();
    }
  }, [accountModalOpen, accountModalTab, user, loadMySessions]);

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
    const uname = newUsername.trim();
    const pw = newUserPw;
    if (!uname || !pw) {
      setAdminMsg({ type: 'err', text: '생성할 아이디와 비밀번호를 입력하세요.' });
      return;
    }
    if (newUserRole !== 'admin' && newUserPlantScope === 'custom' && newUserAllowedPlants.length === 0) {
      setAdminMsg({ type: 'err', text: '개별 공장 선택 모드에서는 최소 1개 이상의 공장을 선택하세요.' });
      return;
    }
    try {
      await adminCreateUser({
        username: uname,
        display_name: newDispName.trim() || uname,
        password: pw,
        role: newUserRole,
        allowed_plants:
          newUserRole === 'admin' || newUserPlantScope === 'all'
            ? null
            : newUserPlantScope === 'simulator_only'
              ? ['simulator_only']
              : newUserAllowedPlants,
      });
      setLastIssuedCreds({ username: uname, password: pw, mode: '생성' });
      const copied = await copyToClipboard(pw);
      setNewUsername('');
      setNewDispName('');
      setNewUserPw('');
      setNewUserPlantScope('simulator_only');
      setNewUserAllowedPlants([]);
      setAdminMsg({
        type: 'ok',
        text: copied
          ? `계정 [${uname}] 생성 완료 · 초기 비밀번호가 클립보드에 복사되었습니다.`
          : `계정 [${uname}] 생성 완료`,
      });
      await loadAdminOverview();
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '사용자 생성 실패' });
    }
  };

  const openEditUserPlants = (u: AdminUserSummary) => {
    const isSimOnly = isSimulatorOnlyUser(u);
    const hasRestricted =
      !isSimOnly &&
      u.role !== 'admin' &&
      Array.isArray(u.allowed_plants) &&
      u.allowed_plants.length > 0 &&
      !u.allowed_plants.includes('*');
    setEditingPlantsUser(u);
    setEditPlantScope(isSimOnly ? 'simulator_only' : hasRestricted ? 'custom' : 'all');
    setEditAllowedPlants(hasRestricted ? [...(u.allowed_plants ?? [])] : []);
  };

  const handleSaveUserPlants = async () => {
    if (!editingPlantsUser) return;
    setAdminMsg(null);
    if (editPlantScope === 'custom' && editAllowedPlants.length === 0) {
      setAdminMsg({ type: 'err', text: '특정 공장 선택 모드에서는 최소 1개 이상의 공장을 선택하세요.' });
      return;
    }
    try {
      await adminUpdateUser(editingPlantsUser.id, {
        allowed_plants:
          editPlantScope === 'all'
            ? null
            : editPlantScope === 'simulator_only'
              ? ['simulator_only']
              : editAllowedPlants,
      });
      setAdminMsg({
        type: 'ok',
        text: `[${editingPlantsUser.username}] 공장 접근 권한이 저장되었습니다.`,
      });
      const editedSelf = editingPlantsUser.id === user.id;
      setEditingPlantsUser(null);
      await loadAdminOverview();
      if (editedSelf) {
        await refreshAuthAndHydrate();
      }
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '공장 권한 변경 실패' });
    }
  };

  const handleRevokeMySession = async (sess: ActiveDeviceSession) => {
    setProfileMsg(null);
    setRevokingSessionId(sess.id);
    try {
      await revokeMySession(sess.id);
      if (sess.is_current) {
        await refreshAuthAndHydrate();
        return;
      }
      setProfileMsg({ type: 'ok', text: '선택한 기기의 로그인 세션이 종료되었습니다.' });
      await loadMySessions();
    } catch (err) {
      setProfileMsg({
        type: 'err',
        text: err instanceof Error ? err.message : '기기 로그아웃 처리에 실패했습니다.',
      });
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleAdminRevokeUserSessions = async (u: AdminUserSummary) => {
    if (!window.confirm(`[${u.username}] 사용자의 모든 활성 로그인 기기(PC/모바일)를 강제 로그아웃할까요?`)) {
      return;
    }
    setAdminMsg(null);
    try {
      await adminRevokeUserSessions(u.id);
      setAdminMsg({ type: 'ok', text: `[${u.username}] 모든 활성 기기 세션이 강제 종료되었습니다.` });
      await loadAdminOverview();
      if (u.id === user.id) {
        await refreshAuthAndHydrate();
      }
    } catch (err) {
      setAdminMsg({ type: 'err', text: err instanceof Error ? err.message : '기기 강제 로그아웃 실패' });
    }
  };

  const handleResetUserPw = async (u: AdminUserSummary) => {
    const suggested = generateStrongPassword();
    const pw = window.prompt(
      `[${u.username}] 계정의 새 임시 비밀번호를 입력하세요 (6자 이상 · 자동 제안값 수정 가능):`,
      suggested
    );
    if (!pw) return;
    try {
      await adminUpdateUser(u.id, { new_password: pw });
      setLastIssuedCreds({ username: u.username, password: pw, mode: '재설정' });
      const copied = await copyToClipboard(pw);
      setAdminMsg({
        type: 'ok',
        text: copied
          ? `[${u.username}] 비밀번호 재설정 완료 · 새 비밀번호가 클립보드에 복사되었습니다.`
          : `[${u.username}] 비밀번호 재설정 완료`,
      });
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

  const handleUpdateFeedbackStatus = async (item: BetaFeedbackItem, nextStatus: FeedbackStatus) => {
    if (item.status === nextStatus) return;
    setAdminMsg(null);
    setUpdatingFeedbackId(item.id);
    try {
      const updated = await adminUpdateFeedback(item.id, { status: nextStatus });
      setFeedbackItems(prev => prev.map(f => (f.id === item.id ? updated : f)));
      const label = FEEDBACK_STATUS_OPTIONS.find(o => o.value === nextStatus)?.label ?? nextStatus;
      setAdminMsg({ type: 'ok', text: `피드백 #${item.id} 상태가 [${label}]로 변경되었습니다.` });
    } catch (err) {
      setAdminMsg({
        type: 'err',
        text: err instanceof Error ? err.message : '피드백 상태 변경 실패',
      });
    } finally {
      setUpdatingFeedbackId(null);
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
              {accountModalTab === 'admin' ? '관리자 콘솔' : '내 계정 및 동기화'}
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
                  시스템 관리자
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
                  {user.email && (
                    <div style={{ fontSize: 11.5, color: '#334155', marginTop: 2 }}>
                      이메일: <b>{user.email}</b>
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                    권한: <b>{user.role === 'admin' ? '시스템 관리자' : '엔지니어 사용자'}</b> · 상태: <b>{user.status}</b> · 접근 공장:{' '}
                    <b>{formatAllowedPlantCodes(user).join(', ')}</b>
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
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    placeholder="새 비밀번호 (6자 이상)"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 12.5 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(v => !v)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 7,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      color: '#334155',
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {showNewPw ? '숨김' : '보기'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newPw) {
                        setProfileMsg({ type: 'err', text: '복사할 새 비밀번호가 비어 있습니다.' });
                        return;
                      }
                      const ok = await copyToClipboard(newPw);
                      setProfileMsg(
                        ok
                          ? { type: 'ok', text: '새 비밀번호가 클립보드에 복사되었습니다.' }
                          : { type: 'err', text: '클립보드 복사에 실패했습니다.' }
                      );
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 7,
                      border: '1px solid #93C5FD',
                      background: '#EFF6FF',
                      color: '#1D4ED8',
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    비번 복사
                  </button>
                </div>
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

              {/* 활성 로그인 기기 목록 */}
              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>
                      활성 로그인 기기 목록
                    </div>
                    <div style={{ fontSize: 10.8, color: '#64748B', marginTop: 2 }}>
                      계정당 PC 1대 + 모바일 1대 동시 로그인 지원
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadMySessions()}
                    disabled={sessionsLoading}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      color: '#334155',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {sessionsLoading ? '조회 중...' : '새로고침'}
                  </button>
                </div>

                {sessionsLoading && mySessions.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: '#64748B', padding: '6px 2px' }}>
                    활성 기기 정보를 불러오는 중...
                  </div>
                ) : mySessions.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: '#64748B', padding: '6px 2px' }}>
                    표시할 활성 로그인 기기가 없습니다.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {mySessions.map(sess => {
                      const isMobile = sess.device_type === 'mobile';
                      const label = sess.device_label || (isMobile ? '모바일 브라우저' : 'PC 브라우저');
                      return (
                        <div
                          key={sess.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: sess.is_current ? '#EFF6FF' : '#F8FAFC',
                            border: sess.is_current ? '1px solid #BFDBFE' : '1px solid #E2E8F0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  background: isMobile ? '#FEF3C7' : '#DBEAFE',
                                  color: isMobile ? '#92400E' : '#1E40AF',
                                }}
                              >
                                {isMobile ? '모바일' : 'PC'}
                              </span>
                              <span style={{ fontSize: 11.8, fontWeight: 700, color: '#0F172A' }}>
                                {label}
                              </span>
                              {sess.is_current && (
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    color: '#1D4ED8',
                                  }}
                                >
                                  (현재 기기)
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                              최근 활동: {formatSessionTime(sess.last_seen_at || sess.created_at)}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={revokingSessionId === sess.id}
                            onClick={() => void handleRevokeMySession(sess)}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 6,
                              border: '1px solid #FCA5A5',
                              background: '#FEF2F2',
                              color: '#B91C1C',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: revokingSessionId === sess.id ? 'wait' : 'pointer',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            {revokingSessionId === sess.id ? '처리 중...' : '로그아웃'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
                              onClick={async () => {
                                const ok = await copyToClipboard(inv.code);
                                setAdminMsg(
                                  ok
                                    ? { type: 'ok', text: `[${inv.code}] 클립보드에 복사되었습니다.` }
                                    : { type: 'err', text: '클립보드 복사에 실패했습니다. 직접 선택하여 복사해 주세요.' }
                                );
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

                {lastIssuedCreds && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      marginBottom: 10,
                      borderRadius: 7,
                      background: '#F0FDF4',
                      border: '1px solid #86EFAC',
                      fontSize: 11.5,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: '#166534' }}>
                      <span style={{ fontWeight: 800 }}>
                        [{lastIssuedCreds.username}] {lastIssuedCreds.mode} 비밀번호:
                      </span>
                      <code
                        style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: '#FFFFFF',
                          border: '1px solid #BBF7D0',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 800,
                          color: '#0F172A',
                          userSelect: 'all',
                        }}
                      >
                        {lastIssuedCreds.password}
                      </code>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyToClipboard(lastIssuedCreds.password);
                          setAdminMsg(
                            ok
                              ? { type: 'ok', text: `[${lastIssuedCreds.username}] 비밀번호가 복사되었습니다.` }
                              : { type: 'err', text: '클립보드 복사에 실패했습니다.' }
                          );
                        }}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 5,
                          border: 'none',
                          background: '#16A34A',
                          color: '#FFFFFF',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        비번 복사
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const combo = `아이디: ${lastIssuedCreds.username}\n비밀번호: ${lastIssuedCreds.password}`;
                          const ok = await copyToClipboard(combo);
                          setAdminMsg(
                            ok
                              ? { type: 'ok', text: `[${lastIssuedCreds.username}] 아이디와 비밀번호를 함께 복사했습니다.` }
                              : { type: 'err', text: '클립보드 복사에 실패했습니다.' }
                          );
                        }}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 5,
                          border: '1px solid #16A34A',
                          background: '#FFFFFF',
                          color: '#166534',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        아이디+비번 함께 복사
                      </button>
                      <button
                        type="button"
                        onClick={() => setLastIssuedCreds(null)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: 5,
                          border: '1px solid #CBD5E1',
                          background: '#FFFFFF',
                          color: '#475569',
                          fontSize: 10.5,
                          cursor: 'pointer',
                        }}
                      >
                        닫기
                      </button>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={handleCreateUser}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}
                >
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="아이디"
                    style={{ width: 115, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <input
                    type="text"
                    value={newDispName}
                    onChange={e => setNewDispName(e.target.value)}
                    placeholder="표시 이름"
                    style={{ width: 115, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5 }}
                  />
                  <input
                    type={showCreateUserPw ? 'text' : 'password'}
                    value={newUserPw}
                    onChange={e => setNewUserPw(e.target.value)}
                    placeholder="초기 비밀번호"
                    style={{ width: 130, padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 11.5, fontFamily: showCreateUserPw ? 'JetBrains Mono, monospace' : 'inherit' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreateUserPw(v => !v)}
                    title="비밀번호 표시 전환"
                    style={{ padding: '6px 7px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#334155', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {showCreateUserPw ? '숨김' : '보기'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const generated = generateStrongPassword();
                      setNewUserPw(generated);
                      setShowCreateUserPw(true);
                      const ok = await copyToClipboard(generated);
                      setAdminMsg({
                        type: 'ok',
                        text: ok
                          ? `강력한 비밀번호 [${generated}] 생성 및 클립보드 복사 완료`
                          : `비밀번호 [${generated}] 생성 완료`,
                      });
                    }}
                    title="초기 비밀번호 자동 생성 후 복사"
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#0F172A', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    자동생성
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newUserPw) {
                        setAdminMsg({ type: 'err', text: '복사할 비밀번호를 입력하거나 자동생성을 누르세요.' });
                        return;
                      }
                      const ok = await copyToClipboard(newUserPw);
                      setAdminMsg(
                        ok
                          ? { type: 'ok', text: '입력된 비밀번호가 클립보드에 복사되었습니다.' }
                          : { type: 'err', text: '클립보드 복사에 실패했습니다.' }
                      );
                    }}
                    title="입력된 비밀번호 복사"
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #93C5FD', background: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    비번 복사
                  </button>
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
                  <PlantPermissionPicker
                    scope={newUserPlantScope}
                    selectedPlants={newUserAllowedPlants}
                    onChangeScope={next => {
                      setNewUserPlantScope(next);
                      if (next === 'custom' && newUserAllowedPlants.length === 0 && SELECTABLE_PLANTS[0]) {
                        setNewUserAllowedPlants([SELECTABLE_PLANTS[0].id]);
                      }
                    }}
                    onTogglePlant={pid =>
                      setNewUserAllowedPlants(prev =>
                        prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]
                      )
                    }
                    disabled={newUserRole === 'admin'}
                    disabledReason="관리자는 항상 전체 공장 접근이 허용됩니다"
                  />
                </form>

                {editingPlantsUser && (
                  <div
                    style={{
                      padding: 10,
                      marginBottom: 10,
                      borderRadius: 8,
                      background: '#EFF6FF',
                      border: '1.5px solid #2563EB',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 900, color: '#1E3A8A' }}>
                        [{editingPlantsUser.username}] ({editingPlantsUser.display_name}) 공장 접근 권한 수정
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => void handleSaveUserPlants()}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 5,
                            border: 'none',
                            background: '#1D4ED8',
                            color: '#FFFFFF',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          권한 저장
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPlantsUser(null)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 5,
                            border: '1px solid #CBD5E1',
                            background: '#FFFFFF',
                            color: '#334155',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                    <PlantPermissionPicker
                      scope={editPlantScope}
                      selectedPlants={editAllowedPlants}
                      onChangeScope={next => {
                        setEditPlantScope(next);
                        if (next === 'custom' && editAllowedPlants.length === 0 && SELECTABLE_PLANTS[0]) {
                          setEditAllowedPlants([SELECTABLE_PLANTS[0].id]);
                        }
                      }}
                      onTogglePlant={pid =>
                        setEditAllowedPlants(prev =>
                          prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]
                        )
                      }
                      disabled={editingPlantsUser.role === 'admin'}
                      disabledReason="관리자 계정은 항상 전체 공장 접근이 허용됩니다"
                    />
                  </div>
                )}

                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 7 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead style={{ background: '#F8FAFC', color: '#475569' }}>
                      <tr>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>아이디 (이름 · 이메일)</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>권한</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>공장 권한</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>활성 기기</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>상태</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>저장 데이터</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => {
                        const plantBadges = formatAllowedPlantCodes(u);
                        const isAllPlants = plantBadges.length === 1 && plantBadges[0] === '전체';
                        const isSimOnly = isSimulatorOnlyUser(u);
                        const showEmail = Boolean(u.email && u.email.toLowerCase() !== u.username.toLowerCase());
                        const desktopCount = u.active_desktop_sessions ?? 0;
                        const mobileCount = u.active_mobile_sessions ?? 0;
                        return (
                        <tr key={u.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <div>
                              <b>{u.username}</b> <span style={{ color: '#64748B' }}>({u.display_name})</span>
                            </div>
                            {showEmail && (
                              <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>
                                {u.email}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              {u.role === 'admin' ? <><UserOutlineIcon size={11} /> 관리자</> : '사용자'}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                              {plantBadges.map(badge => (
                                <span
                                  key={badge}
                                  style={{
                                    padding: '1.5px 6px',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    background: isSimOnly ? '#FEF3C7' : isAllPlants ? '#ECFDF5' : '#EFF6FF',
                                    border: `1px solid ${isSimOnly ? '#F59E0B' : isAllPlants ? '#6EE7B7' : '#93C5FD'}`,
                                    color: isSimOnly ? '#92400E' : isAllPlants ? '#065F46' : '#1E40AF',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                fontFamily: 'JetBrains Mono, monospace',
                                background: desktopCount + mobileCount > 0 ? '#F0F9FF' : '#F8FAFC',
                                border: `1px solid ${desktopCount + mobileCount > 0 ? '#BAE6FD' : '#E2E8F0'}`,
                                color: desktopCount + mobileCount > 0 ? '#0369A1' : '#64748B',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              PC {desktopCount}/1 · 모바일 {mobileCount}/1
                            </span>
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
                            {u.role !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => openEditUserPlants(u)}
                                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #93C5FD', background: '#EFF6FF', color: '#1D4ED8', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                              >
                                공장권한
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleAdminRevokeUserSessions(u)}
                              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#334155', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                            >
                              기기 강제 로그아웃
                            </button>
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 5. 베타 피드백 백로그 */}
              <div style={{ padding: 13, borderRadius: 10, border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                      5. 베타 피드백 백로그 ({feedbackItems.length}건)
                    </span>
                    <span
                      style={{
                        padding: '1.5px 6px',
                        borderRadius: 4,
                        background: '#F1F5F9',
                        border: '1px solid #CBD5E1',
                        color: '#334155',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      신규 {feedbackItems.filter(f => f.status === 'new').length} · 진행{' '}
                      {feedbackItems.filter(f => f.status === 'in_progress').length} · 완료{' '}
                      {feedbackItems.filter(f => f.status === 'done').length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAdminOverview()}
                    disabled={adminLoading}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: '1px solid #CBD5E1',
                      background: '#F8FAFC',
                      fontSize: 10.5,
                      cursor: 'pointer',
                    }}
                  >
                    {adminLoading ? '갱신 중...' : '새로고침'}
                  </button>
                </div>

                {feedbackItems.length === 0 ? (
                  <div
                    style={{
                      padding: '14px 12px',
                      borderRadius: 7,
                      border: '1px solid #E2E8F0',
                      background: '#F8FAFC',
                      color: '#64748B',
                      fontSize: 11.2,
                      textAlign: 'center',
                    }}
                  >
                    접수된 베타 피드백이 아직 없습니다.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: 280,
                      overflowY: 'auto',
                      border: '1px solid #E2E8F0',
                      borderRadius: 7,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {feedbackItems.map((item, idx) => {
                      const catMeta = FEEDBACK_CATEGORY_LABELS[item.category] ?? FEEDBACK_CATEGORY_LABELS.bug;
                      const showEmail = Boolean(
                        item.email && item.email.toLowerCase() !== item.username.toLowerCase()
                      );
                      const busy = updatingFeedbackId === item.id;
                      return (
                        <div
                          key={item.id}
                          style={{
                            padding: '9px 11px',
                            borderTop: idx === 0 ? 'none' : '1px solid #F1F5F9',
                            background: item.status === 'done' ? '#F8FAFC' : '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                            }}
                          >
                            <div style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 11 }}>
                              <span
                                style={{
                                  fontFamily: 'JetBrains Mono, monospace',
                                  fontWeight: 800,
                                  color: '#475569',
                                }}
                              >
                                #{item.id}
                              </span>
                              <span
                                style={{
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  background: catMeta.bg,
                                  border: `1px solid ${catMeta.border}`,
                                  color: catMeta.color,
                                }}
                              >
                                {catMeta.label}
                              </span>
                              <span style={{ fontWeight: 800, color: '#0F172A' }}>
                                {item.username}
                              </span>
                              {showEmail && (
                                <span style={{ color: '#64748B', fontSize: 10.5 }}>
                                  ({item.email})
                                </span>
                              )}
                              <span
                                style={{
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: '#F1F5F9',
                                  color: '#475569',
                                  fontSize: 10,
                                  fontFamily: 'JetBrains Mono, monospace',
                                }}
                              >
                                {item.page_path || '/'}
                              </span>
                              <span style={{ color: '#94A3B8', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                                {formatSessionTime(item.created_at)}
                              </span>
                            </div>

                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              {FEEDBACK_STATUS_OPTIONS.map(opt => {
                                const active = item.status === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleUpdateFeedbackStatus(item, opt.value)}
                                    style={{
                                      padding: '2px 7px',
                                      borderRadius: 4,
                                      border: active ? '1px solid #0F172A' : '1px solid #CBD5E1',
                                      background: active ? '#0F172A' : '#FFFFFF',
                                      color: active ? '#FFFFFF' : '#475569',
                                      fontSize: 10.2,
                                      fontWeight: active ? 800 : 600,
                                      cursor: busy ? 'wait' : 'pointer',
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: 11.5,
                              color: item.status === 'done' ? '#64748B' : '#1E293B',
                              lineHeight: 1.48,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {item.message}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
