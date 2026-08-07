-- 체결 분할 시스템: 가격대별 자식 체결 주문 지원
--
-- 1. parent_order_id 컬럼 추가
--    NULL = 원본 주문, NOT NULL = 자식 체결 주문 (체결 감지 시 서버가 자동 생성)
-- 2. orders_status_check에서 'partially_filled' 제거
--    부분체결 개념을 없애고, 가격대별로 별도 'filled' 주문을 생성하도록 변경

-- 1a. parent_order_id 컬럼 (자기참조 FK — 자식 체결 주문이 원본을 가리킴)
ALTER TABLE orders ADD COLUMN parent_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_parent_order_id ON orders(parent_order_id) WHERE parent_order_id IS NOT NULL;

-- 1b. CHECK constraint에서 'partially_filled' 제거
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status IN ('pending', 'active', 'submitted', 'filled', 'cancelled', 'expired', 'failed')
);
