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
} from '@/lib/storage';
import type { StoredWallet } from '@/lib/storage';
import { MAX_WALLETS, AUTO_LOCK_TIMEOUT } from '@solwallet/config';

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

  // Actions
  initialize: () => void;
  createWallet: (label: string, pin: string) => Promise<WalletInfo & { mnemonic: string }>;
  importWallet: (mnemonic: string, label: string, pin: string) => Promise<WalletInfo>;
  fetchWallets: () => Promise<void>;
  activateWallet: (walletId: string) => Promise<void>;
  deleteWallet: (walletId: string) => Promise<void>;
  lockWallets: () => void;
  unlockWallet: (walletId: string, pin: string) => Promise<void>;
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

function apiFetch(path: string, options?: RequestInit) {
  const token = loadAuthToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
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

  /**
   * 앱 초기화 — localStorage에서 지갑 목록 로드
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

    // 페이지 가시성 변경 시 자동 잠금 (보안)
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          get().lockWallets();
        }
      });
    }
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
      throw new Error(`최대 ${MAX_WALLETS}개의 지갑만 생성할 수 있습니다.`);
    }

    // 1. Keypair 생성
    const { publicKey, secretKey, mnemonic } = createNewWallet();

    // 2. 암호화
    const encrypted = await encryptPrivateKey(secretKey, pin);

    // 3. 서버에 등록
    const res = await apiFetch('/wallets/register', {
      method: 'POST',
      body: JSON.stringify({ publicKey, label }),
    });

    if (!res.ok) {
      // 서버 등록 실패 시 메모리 키 제로화
      zeroizeKey(secretKey);
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || '지갑 등록에 실패했습니다.');
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
      throw new Error(`최대 ${MAX_WALLETS}개의 지갑만 생성할 수 있습니다.`);
    }

    // 1. 시드 구문 복원
    const { publicKey, secretKey } = importPhrase(mnemonic);

    // 중복 지갑 체크
    if (wallets.some((w) => w.publicKey === publicKey)) {
      zeroizeKey(secretKey);
      throw new Error('이미 추가된 지갑입니다.');
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
      throw new Error(error.message || '지갑 등록에 실패했습니다.');
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
   */
  fetchWallets: async () => {
    const token = loadAuthToken();
    if (!token) return;

    const res = await apiFetch('/user/wallets');
    if (!res.ok) return;

    const { data } = await res.json();
    const stored = loadWallets();

    const serverWallets: WalletInfo[] = (data || []).map((w: Record<string, unknown>) => {
      const local = stored.find((s) => s.id === w.id);
      return {
        id: w.id as string,
        publicKey: w.public_key as string,
        label: w.label as string,
        walletIndex: w.wallet_index as number,
        isActive: w.is_active as boolean,
        createdAt: w.created_at as string,
        secretKey: local ? undefined : undefined, // 동기화 후에는 잠금 상태
      };
    });

    const activeWallet = serverWallets.find((w) => w.isActive);

    set({
      wallets: serverWallets,
      activeWalletId: activeWallet?.id || null,
      isLocked: true,
    });
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
      throw new Error(error.message || '지갑 전환에 실패했습니다.');
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
      throw new Error(error.message || '지갑 삭제에 실패했습니다.');
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
      throw new Error('지갑을 찾을 수 없습니다.');
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
      throw new Error('PIN이 올바르지 않습니다.');
    }
  },
}));
