-- order_type 컬럼의 check constraint를 수정하여 'market' 허용
-- 기존: CHECK (order_type = 'limit')
-- 변경: CHECK (order_type IN ('limit', 'market'))

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('limit', 'market'));
