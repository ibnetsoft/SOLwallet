'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * ROI(수익률) 추적 훅
 *
 * localStorage 기반으로 동작 (DB에 별도 스냅샷 테이블이 없는 경우 fallback).
 *
 * - initialBalance: 최초 기록된 잔고 (USDT 환산)
 * - history: 시계열 스냅샷 (최대 30개, 1시간 간격)
 * - recordSnapshot(total): 현재 잔고를 기록 — 잔액 변화 있을 때만 push
 * - recordWithdrawal(usdt): 외부 출금액 누적 — ROI에서 제외하기 위함
 *
 * 수익률 = (현재잔고 + 누적출금액 - 최초잔고) / 최초잔고 * 100
 *
 * ⚠️ 출금액을 더해주는 이유:
 * 출금은 손실이 아니라 자산을 밖으로 옮긴 것뿐인데, 단순히
 * (현재잔고 - 최초잔고)로 계산하면 출금한 만큼 손실로 잡힌다.
 * 예) 100 입금 → 100 출금 시 실제 손익은 0인데 -100(-100%)으로 표시됨.
 * 누적 출금액을 되돌려 더해줘야 거래로 인한 실제 손익만 남는다.
 */

const getInitialKey = (id: string) => `solwallet:roi:initial:${id}`;
const getHistoryKey = (id: string) => `solwallet:roi:history:${id}`;
const getWithdrawnKey = (id: string) => `solwallet:roi:withdrawn:${id}`;
const MAX_POINTS = 30;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // 최소 30분 간격

export interface RoiHistoryPoint {
  t: number; // timestamp
  v: number; // USDT value
}

export interface RoiData {
  initialBalance: number;
  history: RoiHistoryPoint[];
  totalProfit: number;
  roiPct: number;
  /** 누적 외부 출금액 (USDT 환산) — ROI 계산에서 제외됨 */
  withdrawnTotal: number;
  recordSnapshot: (totalUsdt: number) => void;
  /** 외부 출금 발생 시 호출 — 출금액(USDT 환산)을 누적 */
  recordWithdrawal: (usdtValue: number) => void;
  reset: () => void;
}

export function useRoi(walletId: string | undefined, currentTotal: number): RoiData {
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [history, setHistory] = useState<RoiHistoryPoint[]>([]);
  const [withdrawnTotal, setWithdrawnTotal] = useState<number>(0);

  // 초기 로드
  useEffect(() => {
    if (!walletId) {
      setInitialBalance(0);
      setHistory([]);
      setWithdrawnTotal(0);
      return;
    }
    try {
      const init = localStorage.getItem(getInitialKey(walletId));
      const hist = localStorage.getItem(getHistoryKey(walletId));
      const withdrawn = localStorage.getItem(getWithdrawnKey(walletId));
      if (init) setInitialBalance(parseFloat(init));
      else setInitialBalance(0);

      if (hist) setHistory(JSON.parse(hist));
      else setHistory([]);

      setWithdrawnTotal(withdrawn ? parseFloat(withdrawn) || 0 : 0);
    } catch {
      setInitialBalance(0);
      setHistory([]);
      setWithdrawnTotal(0);
    }
  }, [walletId]);

  /** 외부 출금액 누적 — 출금이 손실로 잡히지 않도록 */
  const recordWithdrawal = useCallback(
    (usdtValue: number) => {
      if (!walletId || !usdtValue || usdtValue <= 0) return;
      setWithdrawnTotal((prev) => {
        const next = prev + usdtValue;
        try {
          localStorage.setItem(getWithdrawnKey(walletId), String(next));
        } catch {
          // 무시
        }
        return next;
      });
    },
    [walletId],
  );

  // 스냅샷 기록
  const recordSnapshot = useCallback(
    (totalUsdt: number) => {
      if (!walletId || totalUsdt <= 0) return;

      try {
        // 최초 잔고 설정 (아직 없으면)
        setInitialBalance((prev) => {
          if (prev > 0) return prev;
          localStorage.setItem(getInitialKey(walletId), String(totalUsdt));
          return totalUsdt;
        });

        // 히스토리 업데이트 — 마지막 기록 후 최소 간격 지난 경우만 push
        setHistory((prev) => {
          const now = Date.now();
          const last = prev[prev.length - 1];
          const shouldPush =
            !last || now - last.t >= MIN_INTERVAL_MS || last.v !== totalUsdt;

          if (!shouldPush) return prev;

          // 값이 변경된 경우: 마지막 포인트 갱신 또는 새 포인트 추가
          let next: RoiHistoryPoint[];
          if (last && now - last.t < MIN_INTERVAL_MS) {
            // 같은 구간 내에서는 마지막 포인트를 최신값으로 갱신
            next = [...prev.slice(0, -1), { t: now, v: totalUsdt }];
          } else {
            next = [...prev, { t: now, v: totalUsdt }];
          }

          // 최대 개수 유지
          if (next.length > MAX_POINTS) {
            next = next.slice(next.length - MAX_POINTS);
          }

          localStorage.setItem(getHistoryKey(walletId), JSON.stringify(next));
          return next;
        });
      } catch {
        // 무시
      }
    },
    [walletId],
  );

  // 현재 잔고가 변하면 자동 기록
  useEffect(() => {
    if (walletId && currentTotal > 0) {
      recordSnapshot(currentTotal);
    }
  }, [walletId, currentTotal, recordSnapshot]);

  const reset = useCallback(() => {
    if (!walletId) return;
    localStorage.removeItem(getInitialKey(walletId));
    localStorage.removeItem(getHistoryKey(walletId));
    localStorage.removeItem(getWithdrawnKey(walletId));
    setInitialBalance(0);
    setHistory([]);
    setWithdrawnTotal(0);
  }, [walletId]);

  // 출금액을 되돌려 더해 거래 손익만 남김 (출금이 손실로 잡히는 것 방지)
  const totalProfit = currentTotal + withdrawnTotal - initialBalance;
  const roiPct = initialBalance > 0 ? (totalProfit / initialBalance) * 100 : 0;

  return {
    initialBalance,
    history,
    totalProfit,
    roiPct,
    withdrawnTotal,
    recordSnapshot,
    recordWithdrawal,
    reset,
  };
}
