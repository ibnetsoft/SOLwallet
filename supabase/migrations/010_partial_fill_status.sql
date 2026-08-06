-- =============================================
-- AoiWallet — 부분 체결 상태 추가
-- Migration: 010_partial_fill_status.sql
-- =============================================

-- status CHECK 제약에 'partially_filled' 추가
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'active', 'submitted', 'partially_filled', 'filled', 'cancelled', 'expired', 'failed'));
