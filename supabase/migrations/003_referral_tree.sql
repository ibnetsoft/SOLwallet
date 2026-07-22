-- =============================================
-- DEX MINER BOT — Referral Tree Functions
-- Migration: 003_referral_tree.sql
-- =============================================
--
-- 목적:
--   1. get_referral_subtree — 재귀 CTE로 특정 유저의 하위 전체 트리 조회
--   2. get_referral_ancestors — 특정 유저의 최상위까지 상위 경로 조회
--   3. get_referral_roots — 최상위 추천인 목록 (추천인이 없으면서 누군가를 추천한 유저)
--
-- 실행 방법:
--   Supabase Dashboard → SQL Editor → 본 파일 붙여넣기 → Run
-- =============================================

-- 1. 하위 트리 조회 (재귀 CTE)
--    root_user_id: 트리 루트가 될 유저의 UUID
--    max_depth: 조회할 최대 깊이 (기본 5)
CREATE OR REPLACE FUNCTION get_referral_subtree(
  root_user_id UUID,
  max_depth INT DEFAULT 5
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  first_name TEXT,
  telegram_uid BIGINT,
  referral_code TEXT,
  depth INT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
WITH RECURSIVE ref_tree AS (
  -- Base case: 루트 유저 (depth = 0)
  SELECT
    u.id AS user_id,
    u.username,
    u.first_name,
    u.telegram_uid,
    u.referral_code,
    0 AS depth,
    u.created_at
  FROM users u
  WHERE u.id = root_user_id

  UNION ALL

  -- Recursive case: 직하위 유저들
  SELECT
    u.id AS user_id,
    u.username,
    u.first_name,
    u.telegram_uid,
    u.referral_code,
    rt.depth + 1 AS depth,
    u.created_at
  FROM ref_tree rt
  INNER JOIN users u ON u.referred_by = rt.user_id
  WHERE rt.depth < max_depth
)
SELECT * FROM ref_tree ORDER BY depth, created_at;
$$;

-- 2. 상위 추천인 경로 조회
--    user_id: 경로를 조회할 유저의 UUID
CREATE OR REPLACE FUNCTION get_referral_ancestors(
  user_id UUID
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  first_name TEXT,
  referral_code TEXT,
  depth INT
)
LANGUAGE sql STABLE
AS $$
WITH RECURSIVE ref_path AS (
  -- Base case: 해당 유저의 직접 추천인
  SELECT
    u.id AS user_id,
    u.username,
    u.first_name,
    u.referral_code,
    1 AS depth
  FROM users u
  WHERE u.id = (SELECT referred_by FROM users WHERE id = user_id)

  UNION ALL

  -- Recursive case: 더 위의 추천인
  SELECT
    u.id AS user_id,
    u.username,
    u.first_name,
    u.referral_code,
    rp.depth + 1 AS depth
  FROM ref_path rp
  INNER JOIN users u ON u.id = rp.user_id AND u.referred_by IS NOT NULL
  WHERE u.referred_by IS NOT NULL
)
SELECT * FROM ref_path ORDER BY depth DESC;
$$;

-- 3. 최상위 추천인 목록 (추천인이 없으면서 자신도 누군가를 추천한 유저)
CREATE OR REPLACE FUNCTION get_referral_roots()
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  first_name TEXT,
  telegram_uid BIGINT,
  referral_code TEXT,
  direct_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
SELECT
  u.id AS user_id,
  u.username,
  u.first_name,
  u.telegram_uid,
  u.referral_code,
  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS direct_count,
  u.created_at
FROM users u
WHERE u.referred_by IS NULL
  AND EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_id = u.id)
ORDER BY direct_count DESC, u.created_at ASC;
$$;
