-- =============================================
-- DEX MINER BOT — Manifest 메타데이터 + 상태 확장
-- Migration: 002_manifest_metadata.sql
-- =============================================

-- 1. Manifest 주문 추적용 메타데이터 컬럼 추가
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS manifest_request_id TEXT,
  ADD COLUMN IF NOT EXISTS manifest_client_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS manifest_sequence_number BIGINT,
  ADD COLUMN IF NOT EXISTS manifest_market_address TEXT;

-- 2. status CHECK 제약 확장
-- 기존: 'active','filled','cancelled','expired'
-- 추가: 'pending' (unsigned tx 생성 전), 'submitted' (RPC 전송 후), 'failed' (Manifest 실패)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'active', 'submitted', 'filled', 'cancelled', 'expired', 'failed'));

-- 3. Manifest 메타데이터 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_orders_manifest_client_order_id
  ON orders(manifest_client_order_id) WHERE manifest_client_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_manifest_sequence_number
  ON orders(manifest_sequence_number) WHERE manifest_sequence_number IS NOT NULL;
