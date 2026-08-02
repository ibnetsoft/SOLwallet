-- =============================================
-- AoiWallet — 취소 트랜잭션 서명 분리 보관
-- Migration: 008_cancel_tx_signature.sql
-- =============================================
--
-- 배경: 주문 취소 시 cancel tx 서명을 기존 tx_signature 컬럼에 덮어써서
--       "주문을 넣었던 tx" 기록이 사라지고 있었음. 어드민 화면에서 취소된
--       주문의 Tx Hash를 눌러도 원래 주문 tx를 볼 수 없었음.
--
-- 조치: 취소 tx는 별도 컬럼에 보관하여 주문 tx / 취소 tx 둘 다 남긴다.
--
-- 실행: Supabase Dashboard → SQL Editor → 붙여넣기 → Run
-- =============================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_tx_signature TEXT;
