'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  type AuthStatusResponse,
  type RegistrationMode,
  type UserProfile,
  fetchAuthStatus,
  captureAndGetSignupSource,
  flushPendingWorkspaceSyncs,
  hydrateUserWorkspaceFromServer,
  installStorageSyncInterceptor,
  isEphemeralSessionExpiredOnBoot,
  logoutAccount,
  purgeUserLocalStorageKeys,
  saveAllLocalWorkspacesToServer,
  setWorkspaceSyncListener,
} from '@/lib/auth/authClient';
import { useBalanceStore } from '@/lib/stores/balanceStore';
import { usePFDStore } from '@/lib/stores/pfdStore';
import { useUnitStore } from '@/lib/stores/unitStore';
import {
  PLANT_REGISTRY,
  getPlantRegistryItem,
  isPlantAllowed,
} from '@/lib/plantRegistry';
import { fetchAndRegisterCustomComponents } from '@/lib/calculations/dynamicComponents';

export type SyncState = 'idle' | 'saving' | 'saved' | 'error';

const GUEST_DEMO_KEY = 'chemplant-guest-demo-v1';

interface AuthContextValue {
  loading: boolean;
  authenticated: boolean;
  user: UserProfile | null;
  isGuestDemo: boolean;
  enterGuestDemo: () => void;
  exitGuestDemo: () => void;
  promptGuestAuth: (reason?: string, defaultTab?: 'login' | 'register') => void;
  registrationMode: RegistrationMode;
  dailyAiLimit: number;
  hasServerGemini: boolean;
  localDevBypass: boolean;
  authError: string | null;
  syncStatus: SyncState;
  syncError: string | undefined;
  accountModalOpen: boolean;
  accountModalTab: 'profile' | 'admin';
  openAccountModal: (tab?: 'profile' | 'admin') => void;
  closeAccountModal: () => void;
  refreshAuthAndHydrate: () => Promise<void>;
  handleLoginSuccess: () => Promise<void>;
  handleLogout: () => Promise<void>;
  forceSyncNow: () => Promise<number>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isGuestDemo, setIsGuestDemo] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('invite_only');
  const [dailyAiLimit, setDailyAiLimit] = useState(30);
  const [hasServerGemini, setHasServerGemini] = useState(false);
  const [localDevBypass, setLocalDevBypass] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | undefined>(undefined);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalTab, setAccountModalTab] = useState<'profile' | 'admin'>('profile');

  const applyStatusAndHydrate = useCallback(async () => {
    captureAndGetSignupSource();
    setLoading(true);
    setAuthError(null);
    try {
      if (isEphemeralSessionExpiredOnBoot()) {
        await logoutAccount();
      }
      const st: AuthStatusResponse = await fetchAuthStatus();
      setRegistrationMode(st.registration_mode || 'invite_only');
      setDailyAiLimit(st.daily_ai_limit ?? 30);
      setHasServerGemini(Boolean(st.has_server_gemini));
      setLocalDevBypass(Boolean(st.local_dev_bypass));

      if (st.authenticated && st.user) {
        if (!st.local_dev_bypass) {
          await hydrateUserWorkspaceFromServer(st.user.id);
        } else {
          installStorageSyncInterceptor();
        }
        try {
          await usePFDStore.persist.rehydrate();
        } catch {
          // ignore rehydrate edge case
        }
        try {
          useBalanceStore.getState().hydrateActivePlant();
        } catch {
          // ignore
        }
        try {
          useUnitStore.getState().hydrate(true);
        } catch {
          // ignore
        }
        try {
          const balState = useBalanceStore.getState();
          const curPlant = balState.activePlantId;
          const curMeta = getPlantRegistryItem(curPlant);
          if (
            st.user.role !== 'admin' &&
            Array.isArray(st.user.allowed_plants) &&
            st.user.allowed_plants.length > 0 &&
            !curMeta.isSandbox &&
            !isPlantAllowed(curPlant, st.user)
          ) {
            const firstAllowed = PLANT_REGISTRY.find(
              p => !p.hiddenFromSelector && !p.isSandbox && isPlantAllowed(p.id, st.user)
            );
            if (firstAllowed) {
              balState.setActivePlantId(firstAllowed.id);
            } else {
              balState.setActivePlantId('new_builder');
            }
          }
        } catch {
          // ignore
        }
        try {
          if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(GUEST_DEMO_KEY);
          }
        } catch {
          // ignore
        }
        setIsGuestDemo(false);
        setUser(st.user);
        setAuthenticated(true);
        setSyncStatus('saved');
      } else {
        purgeUserLocalStorageKeys();
        let guestActive = false;
        try {
          if (typeof window !== 'undefined') {
            guestActive = window.sessionStorage.getItem(GUEST_DEMO_KEY) === '1';
          }
        } catch {
          guestActive = false;
        }
        if (guestActive) {
          try {
            const balState = useBalanceStore.getState();
            const curMeta = getPlantRegistryItem(balState.activePlantId);
            if (!curMeta.isSandbox) {
              balState.setActivePlantId('new_builder');
            }
          } catch {
            // ignore
          }
        }
        setIsGuestDemo(guestActive);
        setUser(null);
        setAuthenticated(false);
        setSyncStatus('idle');
      }
      void fetchAndRegisterCustomComponents().catch(() => undefined);
    } catch (err) {
      setUser(null);
      setAuthenticated(false);
      setAuthError(err instanceof Error ? err.message : '인증 서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setWorkspaceSyncListener((state, errMsg) => {
      setSyncStatus(state);
      setSyncError(errMsg);
    });
    void applyStatusAndHydrate();
    return () => {
      setWorkspaceSyncListener(null);
    };
  }, [applyStatusAndHydrate]);

  const handleLoginSuccess = useCallback(async () => {
    await applyStatusAndHydrate();
  }, [applyStatusAndHydrate]);

  const handleLogout = useCallback(async () => {
    setAccountModalOpen(false);
    await logoutAccount();
    setUser(null);
    setAuthenticated(false);
    setSyncStatus('idle');
    setSyncError(undefined);
    await applyStatusAndHydrate();
  }, [applyStatusAndHydrate]);

  const forceSyncNow = useCallback(async (): Promise<number> => {
    if (localDevBypass) return 0;
    await flushPendingWorkspaceSyncs();
    return await saveAllLocalWorkspacesToServer();
  }, [localDevBypass]);

  const enterGuestDemo = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(GUEST_DEMO_KEY, '1');
      }
    } catch {
      // ignore
    }
    try {
      useBalanceStore.getState().setActivePlantId('new_builder');
    } catch {
      // ignore
    }
    setIsGuestDemo(true);
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
      window.location.assign('/flowsheet-simulator');
    }
  }, []);

  const exitGuestDemo = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(GUEST_DEMO_KEY);
      }
    } catch {
      // ignore
    }
    setIsGuestDemo(false);
  }, []);

  const promptGuestAuth = useCallback(
    (reason?: string, defaultTab?: 'login' | 'register') => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('chemeng:prompt-guest-auth', {
            detail: { reason, defaultTab: defaultTab ?? 'register' },
          })
        );
      }
    },
    []
  );

  const openAccountModal = useCallback((tab: 'profile' | 'admin' = 'profile') => {
    setAccountModalTab(tab);
    setAccountModalOpen(true);
  }, []);

  const closeAccountModal = useCallback(() => {
    setAccountModalOpen(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        authenticated,
        user,
        isGuestDemo,
        enterGuestDemo,
        exitGuestDemo,
        promptGuestAuth,
        registrationMode,
        dailyAiLimit,
        hasServerGemini,
        localDevBypass,
        authError,
        syncStatus,
        syncError,
        accountModalOpen,
        accountModalTab,
        openAccountModal,
        closeAccountModal,
        refreshAuthAndHydrate: applyStatusAndHydrate,
        handleLoginSuccess,
        handleLogout,
        forceSyncNow,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
