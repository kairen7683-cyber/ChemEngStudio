'use client';

export type RegistrationMode = 'invite_only' | 'approval' | 'open';

export interface UserProfile {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  status: 'active' | 'pending' | 'disabled';
  daily_ai_count?: number;
  last_login_at?: string | null;
  created_at?: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: UserProfile | null;
  registration_mode: RegistrationMode;
  daily_ai_limit: number;
  has_server_gemini?: boolean;
  local_dev_bypass?: boolean;
}

export interface AdminUserSummary extends UserProfile {
  workspace_count: number;
  workspace_bytes: number;
}

export interface InviteCodeItem {
  code: string;
  memo: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  created_by_name?: string;
}

const ACTIVE_UID_KEY = '__chemplant_active_uid__';
const TRACKED_PREFIXES = [
  'chemplant-',
  'electro-pfd-',
  'chempro_sim_handoff_',
  'CHEMPRO_GEMINI_KEY',
];

export function isTrackedWorkspaceKey(key: string): boolean {
  return TRACKED_PREFIXES.some(prefix => key.startsWith(prefix));
}

let syncInterceptorInstalled = false;
let suppressInterceptor = false;
let originalSetItem: ((key: string, value: string) => void) | null = null;
let originalRemoveItem: ((key: string) => void) | null = null;

const pendingWrites = new Map<string, string | null>();
const debounceTimers = new Map<string, number>();
let syncListener: ((state: 'idle' | 'saving' | 'saved' | 'error', errMsg?: string) => void) | null = null;

export function setWorkspaceSyncListener(
  cb: ((state: 'idle' | 'saving' | 'saved' | 'error', errMsg?: string) => void) | null
): void {
  syncListener = cb;
}

function getRawSetItem(): (key: string, value: string) => void {
  if (originalSetItem) return originalSetItem;
  return (k, v) => window.localStorage.setItem(k, v);
}

function getRawRemoveItem(): (key: string) => void {
  if (originalRemoveItem) return originalRemoveItem;
  return k => window.localStorage.removeItem(k);
}

export function purgeUserLocalStorageKeys(): void {
  if (typeof window === 'undefined') return;
  suppressInterceptor = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && (isTrackedWorkspaceKey(k) || k === ACTIVE_UID_KEY)) {
        keys.push(k);
      }
    }
    const rm = getRawRemoveItem();
    for (const k of keys) {
      rm.call(window.localStorage, k);
    }
  } finally {
    suppressInterceptor = false;
  }
}

async function sendWorkspaceKeyUpdate(key: string, value: string | null, keepalive = false): Promise<void> {
  if (value === null) {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      credentials: 'include',
      keepalive,
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`HTTP ${res.status}`);
    }
    return;
  }
  const res = await fetch(`/api/workspaces/${encodeURIComponent(key)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload_json: value }),
    keepalive,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

function scheduleKeySync(key: string, value: string | null): void {
  if (typeof window === 'undefined' || suppressInterceptor) return;
  if (!isTrackedWorkspaceKey(key)) return;
  // 너무 큰 일회성 키나 임시 핸드오프가 아니면 동기화
  pendingWrites.set(key, value);
  syncListener?.('saving');
  const existing = debounceTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timerId = window.setTimeout(async () => {
    debounceTimers.delete(key);
    const val = pendingWrites.get(key);
    if (val === undefined) return;
    pendingWrites.delete(key);
    try {
      await sendWorkspaceKeyUpdate(key, val);
      if (pendingWrites.size === 0 && debounceTimers.size === 0) {
        syncListener?.('saved');
      }
    } catch (err) {
      syncListener?.('error', err instanceof Error ? err.message : '동기화 오류');
    }
  }, 750);
  debounceTimers.set(key, timerId);
}

export async function flushPendingWorkspaceSyncs(keepalive = false): Promise<void> {
  if (typeof window === 'undefined') return;
  for (const [, timerId] of debounceTimers.entries()) {
    window.clearTimeout(timerId);
  }
  debounceTimers.clear();
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  if (entries.length === 0) return;
  syncListener?.('saving');
  try {
    await Promise.all(entries.map(([k, v]) => sendWorkspaceKeyUpdate(k, v, keepalive)));
    syncListener?.('saved');
  } catch (err) {
    syncListener?.('error', err instanceof Error ? err.message : '저장 동기화 오류');
  }
}

export function installStorageSyncInterceptor(): void {
  if (typeof window === 'undefined' || syncInterceptorInstalled) return;
  syncInterceptorInstalled = true;
  const proto = Object.getPrototypeOf(window.localStorage);
  originalSetItem = proto.setItem;
  originalRemoveItem = proto.removeItem;

  proto.setItem = function patchedSetItem(key: string, value: string) {
    originalSetItem!.call(this, key, value);
    if (this === window.localStorage && !suppressInterceptor) {
      scheduleKeySync(String(key), String(value));
    }
  };

  proto.removeItem = function patchedRemoveItem(key: string) {
    originalRemoveItem!.call(this, key);
    if (this === window.localStorage && !suppressInterceptor) {
      scheduleKeySync(String(key), null);
    }
  };

  window.addEventListener('beforeunload', () => {
    if (pendingWrites.size > 0) {
      void flushPendingWorkspaceSyncs(true);
    }
  });
}

export async function hydrateUserWorkspaceFromServer(userId: number): Promise<void> {
  if (typeof window === 'undefined') return;
  const res = await fetch('/api/workspaces', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`워크스페이스 불러오기 실패 (${res.status})`);
  }
  const data = (await res.json()) as {
    items?: Array<{ workspace_key: string; payload_json: string; updated_at: string }>;
  };
  const items = data.items ?? [];

  // 다른 사용자(또는 비로그인 잔여) 로컬 캐시가 섞이지 않도록 먼저 정리 후 서버 데이터 주입
  purgeUserLocalStorageKeys();
  suppressInterceptor = true;
  try {
    const rawSet = getRawSetItem();
    rawSet.call(window.localStorage, ACTIVE_UID_KEY, String(userId));
    for (const row of items) {
      if (row.workspace_key && typeof row.payload_json === 'string') {
        try {
          rawSet.call(window.localStorage, row.workspace_key, row.payload_json);
        } catch {
          // localStorage 용량 초과 방어
        }
      }
    }
  } finally {
    suppressInterceptor = false;
  }

  installStorageSyncInterceptor();
}

export async function saveAllLocalWorkspacesToServer(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  await flushPendingWorkspaceSyncs();
  const batch: Array<{ workspace_key: string; payload_json: string }> = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !isTrackedWorkspaceKey(k)) continue;
    const v = window.localStorage.getItem(k);
    if (typeof v === 'string') {
      batch.push({ workspace_key: k, payload_json: v });
    }
  }
  if (batch.length === 0) return 0;
  syncListener?.('saving');
  const res = await fetch('/api/workspaces/batch', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: batch }),
  });
  if (!res.ok) {
    syncListener?.('error', `HTTP ${res.status}`);
    throw new Error(`일괄 저장 실패 (${res.status})`);
  }
  syncListener?.('saved');
  return batch.length;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  try {
    const res = await fetch('/api/auth/status', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.status === 404) {
      const isLocalNextDev =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        window.location.port !== '8090';
      if (isLocalNextDev) {
        return {
          authenticated: true,
          local_dev_bypass: true,
          registration_mode: 'invite_only',
          daily_ai_limit: 20,
          user: {
            id: 0,
            username: 'local-dev',
            display_name: '로컬 개발자',
            role: 'admin',
            status: 'active',
          },
        };
      }
      throw new Error('인증 API 서버 응답 없음');
    }
    if (!res.ok) {
      throw new Error(`인증 상태 확인 오류 (${res.status})`);
    }
    return (await res.json()) as AuthStatusResponse;
  } catch (err) {
    throw err instanceof Error ? err : new Error('인증 서버 연결 실패');
  }
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{ user: UserProfile }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  return data;
}

export async function registerUserAccount(payload: {
  username: string;
  password: string;
  display_name: string;
  invite_code?: string;
}): Promise<{ status: 'active' | 'pending'; message: string; user?: UserProfile }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || '가입 요청에 실패했습니다.');
  }
  return data;
}

export async function logoutAccount(): Promise<void> {
  try {
    await flushPendingWorkspaceSyncs(true);
  } catch {
    // ignore
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore
  }
  purgeUserLocalStorageKeys();
  if (typeof window !== 'undefined') {
    window.sessionStorage.clear();
  }
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '비밀번호 변경 실패');
}

// ── Admin API ──────────────────────────────────────────────────────────
export async function adminFetchOverview(): Promise<{
  registration_mode: RegistrationMode;
  daily_ai_limit: number;
  has_gemini_key: boolean;
  users: AdminUserSummary[];
  invites: InviteCodeItem[];
}> {
  const res = await fetch('/api/admin/overview', { credentials: 'include', cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '관리자 정보 조회 실패');
  return data;
}

export async function adminUpdateSettings(patch: {
  registration_mode?: RegistrationMode;
  daily_ai_limit?: number;
  gemini_api_key?: string;
}): Promise<void> {
  const res = await fetch('/api/admin/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '설정 변경 실패');
}

export async function adminCreateUser(payload: {
  username: string;
  display_name: string;
  password: string;
  role: 'admin' | 'user';
}): Promise<void> {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '사용자 생성 실패');
}

export async function adminUpdateUser(
  userId: number,
  patch: {
    status?: 'active' | 'pending' | 'disabled';
    role?: 'admin' | 'user';
    new_password?: string;
    reset_workspace?: boolean;
  }
): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '사용자 수정 실패');
}

export async function adminDeleteUser(userId: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '사용자 삭제 실패');
}

export async function adminCreateInviteCode(payload: {
  code?: string;
  memo: string;
  max_uses: number;
  expires_days?: number | null;
}): Promise<{ code: string }> {
  const res = await fetch('/api/admin/invites', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || '초대코드 생성 실패');
  return data;
}

export async function adminToggleInviteCode(code: string, isActive: boolean): Promise<void> {
  const res = await fetch(`/api/admin/invites/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) throw new Error('초대코드 변경 실패');
}
