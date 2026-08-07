import { create } from 'zustand';
import { createWallet as createNewWallet } from '@/lib/wallet/create';
import { importSeedPhrase as importPhrase } from '@/lib/wallet/import';
import { encryptPrivateKey } from '@/lib/wallet/encrypt';
import { decryptPrivateKey } from '@/lib/wallet/decrypt';
import {
  loadWallets,
  saveWallets,
  addWalletToStorage,
  removeWalletFromStorage,
  updateWalletInStorage,
  loadAuthToken,
  saveAuthToken,
  clearAuthToken,
} from '@/lib/storage';
import type { StoredWallet } from '@/lib/storage';
import { MAX_WALLETS, AUTO_LOCK_TIMEOUT } from '@solwallet/config';
import { getMsg } from '@/lib/i18n';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

// ─── Types ───

export interface WalletInfo {
  id: string;
  publicKey: string;
  label: string;
  walletIndex: number;
  isActive: boolean;
  /** 메모리에 해독된 키 (lockWallets() 호출 시 제거) */
  secretKey?: Uint8Array;
  createdAt?: string;
}

interface WalletState {
  wallets: WalletInfo[];
  activeWalletId: string | null;
  isLocked: boolean;
  isInitialized: boolean;
  /**
   * 서버와 지갑 목록 동기화(fetchWallets)가 최소 1회 완료됐는지 여부.
   * true가 되기 전에는 `wallets`가 이 기기의 localStorage만 반영한 값이라
   * "지갑 0개"로 오판하면 안 됨 (다른 기기에서 이미 만든 지갑이 있을 수 있음).
   */
  walletsSynced: boolean;

  // Actions
  initialize: () => void;
  createWallet: (label: string, pin: string) => Promise<WalletInfo & { mnemonic: string }>;
  importWallet: (mnemonic: string, label: string, pin: string) => Promise<WalletInfo>;
  fetchWallets: () => Promise<void>;
  activateWallet: (walletId: string) => Promise<void>;
  deleteWallet: (walletId: string) => Promise<void>;
  lockWallets: () => void;
  unlockWallet: (walletId: string, pin: string) => Promise<void>;
  decryptWalletSecret: (walletId: string, pin: string) => Promise<Uint8Array>;
  /** 잠금 해제 상태에서 활동이 있을 때 자동 잠금 타이머 연장 (세션 유지) */
  extendSession: () => void;
}

// ─── 자동 잠금 타이머 관리 ───

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

function resetAutoLockTimer(lockFn: () => void) {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    lockFn();
    autoLockTimer = null;
  }, AUTO_LOCK_TIMEOUT);
}

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = loadAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  // 401 — 토큰 만료/무효(삭제된 유저 등) 시 자동 로그아웃 + 재로그인 유도.
  // 토큰만 지우고 리다이렉트를 안 하면, 다음 요청이 토큰 없이 나가
  // "인증 토큰이 필요합니다" 같은 다른 에러로 이어짐.
  if (res.status === 401 && typeof window !== 'undefined') {
    clearAuthToken();
    window.location.href = '/login';
  }

  return res;
}

/**
 * Uint8Array를 안전하게 제로화 (ArrayBuffer까지)
 */
function zeroizeKey(key: Uint8Array | undefined) {
  if (key && key.buffer) {
    new Uint8Array(key.buffer).fill(0);
  }
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallets: [],
  activeWalletId: null,
  isLocked: true,
  isInitialized: false,
  walletsSynced: false,

  /**
   * 앱 초기화 — localStorage에서 지갑 목록을 먼저 로드해 UI를 빠르게 그리고,
   * 그 뒤 서버와 동기화(fetchWallets)한다.
   *
   * fetchWallets()를 여기서 호출하면 모든 진입 페이지(page.tsx, settings/page.tsx)가
   * initialize() 한 번으로 서버 동기화까지 처리할 수 있어, 향후 페이지 추가 시
   * 동기화 호출 누락을 방지한다.
   */
  initialize: () => {
    const stored = loadWallets();
    const wallets: WalletInfo[] = stored.map((w) => ({
      id: w.id,
      publicKey: w.publicKey,
      label: w.label,
      walletIndex: w.walletIndex,
      isActive: w.isActive,
      createdAt: w.createdAt,
    }));

    const activeWallet = wallets.find((w) => w.isActive);
    set({
      wallets,
      activeWalletId: activeWallet?.id || null,
      isLocked: true,
      isInitialized: true,
    });

    // 요청에 따라 탭/앱 숨김 시 즉시 잠금은 제거 — 다른 화면 갔다 와도 세션 유지.
    // 잠금은 이제 AUTO_LOCK_TIMEOUT(24시간) 타이머로만 관리됨.

    // 서버 동기화 — 로컬 우선 렌더 후 백그라운드에서 진행 (fire and forget).
    // 실패해도 로컬 상태는 유지된다.
    void get().fetchWallets();
  },

  /**
   * 새 지갑 생성
   * 1. Keypair 생성
   * 2. PIN으로 암호화 → localStorage 저장
   * 3. 서버에 public key 등록
   * 4. 메모리에서 키 즉시 제거
   */
  createWallet: async (label, pin) => {
    const { wallets } = get();
    if (wallets.length >= MAX_WALLETS) {
      throw new Error(getMsg('error.maxWallets', { max: MAX_WALLETS }));
    }

    // 1. Keypair 생성
    const { publicKey, secretKey, mnemonic } = createNewWallet();

    // 2. 암호화
    const encrypted = await encryptPrivateKey(secretKey, pin);

    // 3. 서버에 등록
    const res = await apiFetch('/wallets/register', {
      method: 'POST',
      body: JSON.stringify({ publicKey, label, mnemonic }),
    });

    if (!res.ok) {
      // 서버 등록 실패 시 메모리 키 제로화
      zeroizeKey(secretKey);
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || getMsg('error.walletRegisterFailed'));
    }

    const serverWallet = await res.json();
    const walletId = serverWallet.data.id;

    // 4. localStorage에 저장
    const storedWallet: StoredWallet = {
      id: walletId,
      publicKey,
      encrypted,
      label: serverWallet.data.label || label,
      walletIndex: serverWallet.data.wallet_index,
      isActive: serverWallet.data.is_active,
      createdAt: serverWallet.data.created_at,
    };

    addWalletToStorage(storedWallet);
    const newWallet: WalletInfo = {
      id: walletId,
      publicKey,
      label: storedWallet.label,
      walletIndex: storedWallet.walletIndex,
      isActive: storedWallet.isActive,
      createdAt: storedWallet.createdAt,
    };

    set((state) => ({
      wallets: [...state.wallets, newWallet],
      activeWalletId: newWallet.isActive ? newWallet.id : state.activeWalletId,
      isLocked: true, // 생성 후 기본 잠금 상태
    }));

    // 메모리에서 임시 키 제거 (mnemonic은 반환하므로 유지)
    zeroizeKey(secretKey);

    return { ...newWallet, mnemonic };
  },

  /**
   * 시드 구문으로 지갑 임포트
   */
  importWallet: async (mnemonic, label, pin) => {
    const { wallets } = get();
    if (wallets.length >= MAX_WALLETS) {
      throw new Error(getMsg('error.maxWallets', { max: MAX_WALLETS }));
    }

    // 1. 시드 구문 복원
    const { publicKey, secretKey } = importPhrase(mnemonic);

    // 중복 지갑 체크
    if (wallets.some((w) => w.publicKey === publicKey)) {
      zeroizeKey(secretKey);
      throw new Error(getMsg('error.walletExists'));
    }

    // 2. 암호화
    const encrypted = await encryptPrivateKey(secretKey, pin);

    // 3. 서버에 등록
    const res = await apiFetch('/wallets/register', {
      method: 'POST',
      body: JSON.stringify({ publicKey, label }),
    });

    if (!res.ok) {
      zeroizeKey(secretKey);
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || getMsg('error.walletRegisterFailed'));
    }

    const serverWallet = await res.json();
    const walletId = serverWallet.data.id;

    // 4. localStorage에 저장
    const storedWallet: StoredWallet = {
      id: walletId,
      publicKey,
      encrypted,
      label: serverWallet.data.label || label,
      walletIndex: serverWallet.data.wallet_index,
      isActive: serverWallet.data.is_active,
      createdAt: serverWallet.data.created_at,
    };

    addWalletToStorage(storedWallet);
    const newWallet: WalletInfo = {
      id: walletId,
      publicKey,
      label: storedWallet.label,
      walletIndex: storedWallet.walletIndex,
      isActive: storedWallet.isActive,
      createdAt: storedWallet.createdAt,
    };

    set((state) => ({
      wallets: [...state.wallets, newWallet],
      activeWalletId: newWallet.isActive ? newWallet.id : state.activeWalletId,
    }));

    // 메모리에서 키 제거
    zeroizeKey(secretKey);

    return newWallet;
  },

  /**
   * 서버에서 지갑 목록 동기화
   *
   * 서버가 지갑의 '진실의 원천(source of truth)'이다. 서버 데이터를 기준으로
   * 메모리와 localStorage를 재구성한다. 단, 개인키(encrypted blob)와
   * mnemonic은 서버에 저장되지 않으므로 기존 localStorage에서 보존해 병합한다.
   *
   * 사용 시나리오:
   * - 다른 기기/브라우저에서 생성한 지갑이 서버에는 있고 로컬에는 없는 경우
   * - 시크릿 모드/캐시 삭제 후 재접속한 경우
   * - 활성 지갑이 다른 기기에서 변경된 경우
   *
   * 주의: 로컬에만 있고 서버에 없는 지갑(예: 서버 등록 실패 후 로컬만 남은 orphan)은
   * 서버 삭제 API를 호출할 수 없으므로 여기서 정리한다. 단 encrypted blob이 있으면
   * 사용자가 잠금 해제할 수 있으므로 보존한다.
   */
  fetchWallets: async () => {
    try {
      const token = loadAuthToken();
      if (!token) return;

      let res: Response;
      try {
        res = await apiFetch('/user/wallets');
      } catch {
        // 네트워크 오류 — 로컬 상태 유지
        return;
      }
      if (!res.ok) return;

      const { data } = await res.json();
      const stored = loadWallets();

      // 서버 지갑(snake_case) → WalletInfo + StoredWallet 병합
      const serverRows = (data || []) as Record<string, unknown>[];
      const mergedStorage: StoredWallet[] = [];
      const serverWallets: WalletInfo[] = serverRows.map((w) => {
        const local = stored.find((s) => s.id === (w.id as string));
        // 로컬에 encrypted blob이 있으면 보존 (개인키는 서버에 없음)
        const storedWallet: StoredWallet = {
          id: w.id as string,
          publicKey: w.public_key as string,
          encrypted: local?.encrypted as StoredWallet['encrypted'],
          mnemonic: local?.mnemonic,
          label: (w.label as string) || local?.label || '',
          walletIndex: w.wallet_index as number,
          isActive: w.is_active as boolean,
          createdAt: w.created_at as string,
        };
        mergedStorage.push(storedWallet);
        return {
          id: storedWallet.id,
          publicKey: storedWallet.publicKey,
          label: storedWallet.label,
          walletIndex: storedWallet.walletIndex,
          isActive: storedWallet.isActive,
          createdAt: storedWallet.createdAt,
          // 동기화 후에는 잠금 상태 — secretKey는 메모리에 두지 않음
        };
      });

      // localStorage에 병합 결과 저장 (잠금 해제/삭제 시 일관성 유지)
      saveWallets(mergedStorage);

      const activeWallet = serverWallets.find((w) => w.isActive);

      set({
        wallets: serverWallets,
        activeWalletId: activeWallet?.id || serverWallets[0]?.id || null,
        isLocked: true,
      });
    } finally {
      // 성공/실패/토큰없음 등 모든 경로에서 "동기화 시도는 끝났다"로 표시.
      // 이게 있어야 홈 화면이 "동기화 전 로컬 상태만 보고 지갑 0개로 오판"하지 않음
      set({ walletsSynced: true });
    }
  },

  /**
   * 활성 지갑 전환
   */
  activateWallet: async (walletId) => {
    const res = await apiFetch(`/wallets/${walletId}/activate`, {
      method: 'PATCH',
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || getMsg('error.walletSwitchFailed'));
    }

    // 로컬 상태 + localStorage 업데이트
    const wallets = get().wallets.map((w) => ({
      ...w,
      isActive: w.id === walletId,
    }));

    updateWalletInStorage(walletId, { isActive: true });
    wallets
      .filter((w) => w.id !== walletId)
      .forEach((w) => updateWalletInStorage(w.id, { isActive: false }));

    set({ wallets, activeWalletId: walletId });
  },

  /**
   * 지갑 삭제
   */
  deleteWallet: async (walletId) => {
    const res = await apiFetch(`/wallets/${walletId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || getMsg('error.walletDeleteFailed'));
    }

    removeWalletFromStorage(walletId);

    const { wallets, activeWalletId } = get();
    const remaining = wallets.filter((w) => w.id !== walletId);
    let newActiveId = activeWalletId;

    // 활성 지갑이 삭제된 경우 다른 지갑으로 자동 전환
    if (activeWalletId === walletId) {
      const fallback = remaining[0];
      newActiveId = fallback?.id || null;
      // 서버에도 활성 지갑 변경 알림
      if (fallback) {
        try {
          await apiFetch(`/wallets/${fallback.id}/activate`, { method: 'PATCH' });
          updateWalletInStorage(fallback.id, { isActive: true });
        } catch {
          // 실패해도 로컬에서는 전환
        }
      }
    }

    set({
      wallets: remaining.map((w) => ({
        ...w,
        isActive: w.id === newActiveId,
      })),
      activeWalletId: newActiveId,
    });
  },

  /**
   * 모든 지갑 잠금 — 메모리에서 키 제로화 후 제거
   */
  lockWallets: () => {
    const wallets = get().wallets;
    // 모든 secretKey를 제로화
    wallets.forEach((w) => zeroizeKey(w.secretKey));

    set({
      wallets: wallets.map((w) => ({ ...w, secretKey: undefined })),
      isLocked: true,
    });
    clearAutoLockTimer();
  },

  /**
   * 특정 지갑 잠금 해제 — PIN으로 복호화하여 메모리에 로드
   * 자동 잠금 타이머 시작
   */
  unlockWallet: async (walletId, pin) => {
    const stored = loadWallets();
    const target = stored.find((w) => w.id === walletId);

    if (!target) {
      throw new Error(getMsg('error.walletNotFound'));
    }

    // 다른 기기에서 생성해 이 기기에는 개인키(encrypted)가 없는 경우
    if (!target.encrypted) {
      throw new Error(getMsg('error.walletKeyMissing'));
    }

    try {
      const secretKey = await decryptPrivateKey(target.encrypted, pin);

      set((state) => ({
        wallets: state.wallets.map((w) =>
          w.id === walletId ? { ...w, secretKey } : w,
        ),
        isLocked: false,
      }));

      // 자동 잠금 타이머 시작
      resetAutoLockTimer(() => get().lockWallets());
    } catch {
      throw new Error(getMsg('error.wrongPin'));
    }
  },

  decryptWalletSecret: async (walletId, pin) => {
    const stored = loadWallets();
    const target = stored.find((w) => w.id === walletId);

    if (!target) {
      throw new Error(getMsg('error.walletNotFound'));
    }

    if (!target.encrypted) {
      throw new Error(getMsg('error.walletKeyMissing'));
    }

    try {
      return await decryptPrivateKey(target.encrypted, pin);
    } catch {
      throw new Error(getMsg('error.wrongPin'));
    }
  },

  extendSession: () => {
    if (!get().isLocked) {
      resetAutoLockTimer(() => get().lockWallets());
    }
  },
}));
