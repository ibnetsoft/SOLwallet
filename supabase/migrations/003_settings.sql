-- =============================================
-- DEX MINER BOT — 범용 설정 테이블
-- Migration: 003_settings.sql
-- =============================================

-- 범용 key-value 설정 저장 (수수료율, 최소주문금액 등 확장 가능)
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at 자동 갱신 트리거
CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 초기값: 거래 수수료율 1% (0.01)
INSERT INTO settings (key, value) VALUES ('fee_rate', '0.01')
  ON CONFLICT (key) DO NOTHING;
