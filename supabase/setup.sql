-- =============================================
-- DEX MINER BOT — Full Database Setup
-- =============================================
-- Supabase Dashboard > SQL Editor 에 복사해서 실행하세요
-- https://yvnxbalfktdxhlcbftax.supabase.co > SQL Editor (New query)
-- =============================================

-- 1. Users (회원 테이블)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_uid  BIGINT UNIQUE NOT NULL,
  username      TEXT,
  first_name    TEXT DEFAULT '',
  last_name     TEXT DEFAULT '',
  referred_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Wallets (지갑 테이블)
CREATE TABLE IF NOT EXISTS wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,
  wallet_index  SMALLINT NOT NULL DEFAULT 0 CHECK (wallet_index >= 0 AND wallet_index < 3),
  label         TEXT NOT NULL DEFAULT 'Wallet 1',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

-- 3. Tokens (어드민 토큰 등록 테이블)
CREATE TABLE IF NOT EXISTS tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint_address  TEXT UNIQUE NOT NULL,
  symbol        TEXT NOT NULL,
  decimals      SMALLINT NOT NULL DEFAULT 9,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_active ON tokens(is_active) WHERE is_active = TRUE;

-- 4. Orders (주문 테이블)
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id         UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_id          UUID NOT NULL REFERENCES tokens(id),
  side              TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type        TEXT NOT NULL DEFAULT 'limit' CHECK (order_type = 'limit'),
  price             NUMERIC(18, 6) NOT NULL,
  quantity          NUMERIC(18, 6) NOT NULL,
  filled_qty        NUMERIC(18, 6) NOT NULL DEFAULT 0,
  fee               NUMERIC(18, 6) NOT NULL DEFAULT 0,
  fee_rate          NUMERIC(5, 4) NOT NULL DEFAULT 0.0100,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'filled', 'cancelled', 'expired')),
  tx_signature      TEXT,
  manifest_order_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_orders_token_id ON orders(token_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 5. Referrals (추천인 트래킹 테이블)
CREATE TABLE IF NOT EXISTS referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals(created_at DESC);

-- =============================================
-- Updated_at trigger function (auto-update)
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Seed Data (초기 토큰)
-- =============================================

INSERT INTO tokens (mint_address, symbol, decimals, is_active) VALUES
  ('So11111111111111111111111111111111111111112', 'SOL', 9, TRUE),
  ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDT', 6, TRUE)
ON CONFLICT (mint_address) DO NOTHING;

-- =============================================
-- 확인 쿼리 (선택)
-- =============================================
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- SELECT * FROM tokens;
