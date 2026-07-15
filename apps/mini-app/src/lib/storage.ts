import type { EncryptedWallet } from './wallet';

const STORAGE_PREFIX = 'solwallet_';

/**
 * localStorage/IndexedDB 기반 지갑 저장 유틸리티
 * — Private key는 절대 평문으로 저장하지 않음 (항상 암호화 상태)
 */

// ─── Keys ───
const KEYS = {
  encryptedWallets: `${STORAGE_PREFIX}wallets`,
  authToken: `${STORAGE_PREFIX}auth_token`,
  userPreferences: `${STORAGE_PREFIX}preferences`,
} as const;

// ─── Types ───
export interface StoredWallet {
  id: string;             // 서버 UUID
  publicKey: string;
  encrypted: EncryptedWallet; // 암호화된 secretKey
  mnemonic?: string;      // 암호화된 시드 구문 (선택적)
  label: string;
  walletIndex: number;
  isActive: boolean;
  createdAt: string;
}

// ─── Wallet Storage ───

export function loadWallets(): StoredWallet[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(KEYS.encryptedWallets);
    if (!raw) return [];
    return JSON.parse(raw) as StoredWallet[];
  } catch {
    console.error('Failed to load wallets from storage');
    return [];
  }
}

export function saveWallets(wallets: StoredWallet[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(KEYS.encryptedWallets, JSON.stringify(wallets));
  } catch (error) {
    console.error('Failed to save wallets to storage:', error);
  }
}

export function addWalletToStorage(wallet: StoredWallet): StoredWallet[] {
  const wallets = loadWallets();
  wallets.push(wallet);
  saveWallets(wallets);
  return wallets;
}

export function removeWalletFromStorage(walletId: string): StoredWallet[] {
  const wallets = loadWallets().filter((w) => w.id !== walletId);
  saveWallets(wallets);
  return wallets;
}

export function updateWalletInStorage(
  walletId: string,
  updates: Partial<StoredWallet>,
): StoredWallet[] {
  const wallets = loadWallets().map((w) =>
    w.id === walletId ? { ...w, ...updates } : w,
  );
  saveWallets(wallets);
  return wallets;
}

// ─── Auth Token Storage ───

export function loadAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEYS.authToken);
}

export function saveAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.authToken, token);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEYS.authToken);
}

// ─── Clear All ───

export function clearAllStorage(): void {
  if (typeof window === 'undefined') return;
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
}
