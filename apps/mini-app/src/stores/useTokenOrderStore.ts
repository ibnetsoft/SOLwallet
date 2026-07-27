import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ─── Types ───

interface TokenOrderState {
  /** 사용자가 정렬한 토큰 symbol 순서 */
  order: string[];
  moveUp: (symbol: string) => void;
  moveDown: (symbol: string) => void;
  setOrder: (order: string[]) => void;
  resetOrder: () => void;
}

/**
 * 홈 화면 토큰 표시 순서 (사용자 정렬)
 *
 * localStorage에 symbol 배열을 저장하여 새로고침/재접속 시에도
 * 사용자가 변경한 순서를 유지합니다. 기기/브라우저마다 독립 적용됩니다.
 *
 * order 배열에 없는 symbol은 항상 뒤에 표시됩니다(기존 DB 등록 순서 유지).
 */
export const useTokenOrderStore = create<TokenOrderState>()(
  persist(
    (set, get) => ({
      // 기본 순서 (USDC가 먼저 — 이전 하드코딩과 동일)
      order: ['USDC', 'USDT', 'SOL'],

      moveUp: (symbol) => {
        const current = get().order;
        const idx = current.indexOf(symbol);
        if (idx <= 0) return;
        const next = [...current];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        set({ order: next });
      },

      moveDown: (symbol) => {
        const current = get().order;
        const idx = current.indexOf(symbol);
        if (idx === -1 || idx >= current.length - 1) return;
        const next = [...current];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        set({ order: next });
      },

      setOrder: (order) => set({ order }),

      resetOrder: () => set({ order: ['USDC', 'USDT', 'SOL'] }),
    }),
    {
      name: 'aoi-token-order',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/**
 * 표시할 전체 토큰 심볼 목록을 사용자 정렬 순서로 반환합니다.
 *
 * baseTokens(USDC/USDT/SOL)는 항상 order에 포함되어 있고,
 * otherSymbols에는 order에 없는 심볼을 뒤에 붙입니다.
 */
export function sortSymbolsByUserOrder(
  allSymbols: string[],
  userOrder: string[],
): string[] {
  // 사용자 order에 있는 심볼은 order 순서대로, 그 외는 원래 순서대로 뒤에
  const ordered = userOrder.filter((s) => allSymbols.includes(s));
  const rest = allSymbols.filter((s) => !userOrder.includes(s));
  return [...ordered, ...rest];
}
