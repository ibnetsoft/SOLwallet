-- ROI 초기값(baseline) 테이블 — 지갑에 코인이 최초로 들어왔을 때의 달러 가치를
-- 코인별로 기록해두고, 전부 합산한 값을 ROI 계산의 "초기값"으로 사용한다.
-- (과거 시세 이력이 없어 usd_value_at_deposit은 이 기능이 처음 그 코인을
-- 감지한 시점의 현재가로 근사 계산되며, 이후 다시 계산되지 않고 고정된다.)

CREATE TABLE IF NOT EXISTS wallet_deposit_baseline (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id             UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  mint_address          TEXT NOT NULL,
  symbol                TEXT NOT NULL,
  first_amount          NUMERIC(18, 9) NOT NULL,
  usd_value_at_deposit  NUMERIC(18, 6) NOT NULL,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, mint_address)
);

CREATE INDEX IF NOT EXISTS idx_wallet_deposit_baseline_wallet ON wallet_deposit_baseline(wallet_id);
