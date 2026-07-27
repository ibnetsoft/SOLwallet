-- =============================================
-- AoiWallet — Seed Data
-- =============================================

-- Initial tokens for the mini-app
INSERT INTO tokens (mint_address, symbol, decimals, is_active) VALUES
  ('So11111111111111111111111111111111111111112', 'SOL', 9, TRUE),
  ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 6, TRUE),
  ('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT', 6, TRUE)
ON CONFLICT (mint_address) DO NOTHING;
