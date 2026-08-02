'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * ROI(수익률) 추적 훅
 *
 * initialBalance(초기값)와 withdrawnTotal(누적 출금액)은 서버가 계산해서 내려준다
 * (지갑에 각 코인이 "최초로" 입금됐을 때의 달러 가치를 코인별로 합산한 값 —
 * balance.service.ts의 wallet_deposit_baseline 기반). 기기와 무관하게 항상 동일한
 * 값이 나오도록 하기 위해 localStorage가 아닌 서버를 기준으로 삼는다.
 *
 * history(스프라인용 시계열)만 기기-로컬 localStorage에 남긴다 — 표시용일 뿐
 * ROI 정확도에 영향을 주지 않는 보조 데이터라 서버 이전 대상에서 제외.
 *
 * 수익률 = (현재잔고 + 누적출금액 - 초기값) / 초기값 * 100
 *
 * ⚠️ 출금액을 더해주는 이유:
 * 출금은 손실이 아니라 자산을 밖으로 옮긴 것뿐인데, 단순히
 * (현재잔고 - 초기값)로 계산하면 출금한 만큼 손실로 잡힌다.
 * 누적 출금액을 되돌려 더해줘야 거래로 인한 실제 손익만 남는다.
 */

const getHistoryKey = (id: string) => `solwallet:roi:history:${id}`;
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
  reset: () => void;
}

export function useRoi(
  walletId: string | undefined,
  currentTotal: number,
  serverInitialBalance: number,
  serverWithdrawnTotal: number,
): RoiData {
  const [history, setHistory] = useState<RoiHistoryPoint[]>([]);

  // 초기 로드 — history(스파크라인)만 기기-로컬로 유지
  useEffect(() => {
    if (!walletId) {
      setHistory([]);
      return;
    }
    try {
      const hist = localStorage.getItem(getHistoryKey(walletId));
      setHistory(hist ? JSON.parse(hist) : []);
    } catch {
      setHistory([]);
    }
  }, [walletId]);

  // 스파크라인 히스토리만 기록 (초기값/출금액은 서버 값을 그대로 씀)
  const recordSnapshot = useCallback(
    (totalUsdt: number) => {
      if (!walletId || totalUsdt <= 0) return;

      try {
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
    localStorage.removeItem(getHistoryKey(walletId));
    setHistory([]);
  }, [walletId]);

  // 출금액을 되돌려 더해 거래 손익만 남김 (출금이 손실로 잡히는 것 방지)
  const totalProfit = currentTotal + serverWithdrawnTotal - serverInitialBalance;
  const roiPct = serverInitialBalance > 0 ? (totalProfit / serverInitialBalance) * 100 : 0;

  return {
    initialBalance: serverInitialBalance,
    history,
    totalProfit,
    roiPct,
    withdrawnTotal: serverWithdrawnTotal,
    recordSnapshot,
    reset,
  };
}
