import { create } from 'zustand';

interface WalletState {
  wallets: WalletInfo[];
  activeWalletIndex: number;
  setActiveWallet: (index: number) => void;
  addWallet: (wallet: WalletInfo) => void;
}

export interface WalletInfo {
  publicKey: string;
  label: string;
  index: number;
}

export const useWalletStore = create<WalletState>((set) => ({
  wallets: [],
  activeWalletIndex: 0,
  setActiveWallet: (index) => set({ activeWalletIndex: index }),
  addWallet: (wallet) =>
    set((state) => ({
      wallets: [...state.wallets, wallet],
    })),
}));
