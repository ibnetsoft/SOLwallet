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
 *
 * 수익률 = (현재잔고 - 최초잔고) / 최초잔고 * 100
 */

const STORAGE_KEY_INITIAL = 'solwallet:roi:initial';
const STORAGE_KEY_HISTORY = 'solwallet:roi:history';
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
  recordSnapshot: (totalUsdt: number) => void;
  reset: () => void;
}

export function useRoi(currentTotal: number): RoiData {
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [history, setHistory] = useState<RoiHistoryPoint[]>([]);

  // 초기 로드
  useEffect(() => {
    try {
      const init = localStorage.getItem(STORAGE_KEY_INITIAL);
      const hist = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (init) setInitialBalance(parseFloat(init));
      if (hist) setHistory(JSON.parse(hist));
    } catch {
      // 무시
    }
  }, []);

  // 스냅샷 기록
  const recordSnapshot = useCallback(
    (totalUsdt: number) => {
      if (totalUsdt <= 0) return;

      try {
        // 최초 잔고 설정 (아직 없으면)
        setInitialBalance((prev) => {
          if (prev > 0) return prev;
          localStorage.setItem(STORAGE_KEY_INITIAL, String(totalUsdt));
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

          localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
          return next;
        });
      } catch {
        // 무시
      }
    },
    [],
  );

  // 현재 잔고가 변하면 자동 기록
  useEffect(() => {
    if (currentTotal > 0) {
      recordSnapshot(currentTotal);
    }
  }, [currentTotal, recordSnapshot]);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY_INITIAL);
    localStorage.removeItem(STORAGE_KEY_HISTORY);
    setInitialBalance(0);
    setHistory([]);
  }, []);

  const totalProfit = currentTotal - initialBalance;
  const roiPct = initialBalance > 0 ? (totalProfit / initialBalance) * 100 : 0;

  return {
    initialBalance,
    history,
    totalProfit,
    roiPct,
    recordSnapshot,
    reset,
  };
}
