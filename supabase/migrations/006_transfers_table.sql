-- 출금/입금 내역 테이블 — RPC rate limit 의존성 제거
-- 출금 성공 시 DB에 기록하여 히스토리에서 안정적으로 표시

CREATE TABLE IF NOT EXISTS transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  type            TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
  amount          NUMERIC(18, 9) NOT NULL,
  token_symbol    TEXT NOT NULL,
  token_mint      TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  tx_signature    TEXT,
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_user_id ON transfers(user_id);
CREATE INDEX idx_transfers_wallet_id ON transfers(wallet_id);
CREATE INDEX idx_transfers_created_at ON transfers(created_at DESC);
