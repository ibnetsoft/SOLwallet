-- =============================================
-- AoiWallet - Sponsor column
-- Migration: 004_sponsor_column.sql
-- =============================================

-- 1. is_sponsor column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_sponsor BOOLEAN DEFAULT false;

-- 2. index
CREATE INDEX IF NOT EXISTS idx_users_is_sponsor
  ON users(is_sponsor) WHERE is_sponsor = true;
