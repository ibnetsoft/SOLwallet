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
import { MAX_WALLETS } from '@solwallet/config';

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
  },

  /**
   * 새 지갑 생성
   * 1. Keypair 생성
   * 2. PIN으로 암호화 → localStorage 저장
   * 3. 서버에 public key 등록
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

    const updatedStored = addWalletToStorage(storedWallet);
    const newWallet: WalletInfo = {
      id: walletId,
      publicKey,
      label: storedWallet.label,
      walletIndex: storedWallet.walletIndex,
      isActive: storedWallet.isActive,
      createdAt: storedWallet.createdAt,
      secretKey, // 메모리에 임시 보관 (unlock 상태)
    };

    set((state) => ({
      wallets: [...state.wallets, newWallet],
      activeWalletId: newWallet.isActive ? newWallet.id : state.activeWalletId,
      isLocked: false,
    }));

    // 메모리에서 키 제거 (기본적으로 lock 상태 유지)
    get().lockWallets();

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
    const serverWallets: WalletInfo[] = (data || []).map((w: Record<string, unknown>) => ({
      id: w.id as string,
      publicKey: w.public_key as string,
      label: w.label as string,
      walletIndex: w.wallet_index as number,
      isActive: w.is_active as boolean,
      createdAt: w.created_at as string,
    }));

    const activeWallet = serverWallets.find((w) => w.isActive);

    // localStorage와 병합 (암호화 데이터는 localStorage 것이 우선)
    const stored = loadWallets();
    const merged = serverWallets.map((sw) => {
      const local = stored.find((s) => s.id === sw.id);
      if (local) {
        return sw;
      }
      return sw;
    });

    saveWallets(
      merged.map((w) => {
        const local = stored.find((s) => s.id === w.id);
        return {
          id: w.id,
          publicKey: w.publicKey,
          encrypted: local?.encrypted || { ciphertext: '', iv: '', salt: '', version: 1 },
          label: w.label,
          walletIndex: w.walletIndex,
          isActive: w.isActive,
          createdAt: w.createdAt || new Date().toISOString(),
        };
      }),
    );

    set({
      wallets: merged,
      activeWalletId: activeWallet?.id || null,
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

    // 로컬 상태 업데이트
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
    const newActiveId =
      activeWalletId === walletId
        ? remaining.find((w) => w.isActive)?.id || remaining[0]?.id || null
        : activeWalletId;

    set({ wallets: remaining, activeWalletId: newActiveId });
  },

  /**
   * 모든 지갑 잠금 — 메모리에서 키 해제
   */
  lockWallets: () => {
    const wallets = get().wallets.map((w) => ({
      ...w,
      secretKey: undefined,
    }));
    set({ wallets, isLocked: true });
  },

  /**
   * 특정 지갑 잠금 해제 — PIN으로 복호화하여 메모리에 로드
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
    } catch {
      throw new Error('PIN이 올바르지 않습니다.');
    }
  },
}));
