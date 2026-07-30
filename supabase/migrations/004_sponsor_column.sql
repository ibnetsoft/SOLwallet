-- =============================================
-- AoiWallet — Sponsor(방장) 컬럼 추가
-- Migration: 004_sponsor_column.sql
--
-- 목적:
--   방장(스폰서)을 추천 기록이 아닌 어드민이 직접 지정하도록 변경.
--   users 테이블에 is_sponsor boolean 컬럼 추가.
--
-- 실행 방법:
--   Supabase Dashboard → SQL Editor → 본 파일 붙여넣기 → Run
-- =============================================

-- 1. is_sponsor 컬럼 추가 (기본값 false)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_sponsor BOOLEAN NOT NULL DEFAULT false;

-- 2. 방장 전용 인덱스
CREATE INDEX IF NOT EXISTS idx_users_is_sponsor
  ON users(is_sponsor) WHERE is_sponsor = true;

-- 3. 총 추천인 수(하위 전체)를 빠르게 조회하기 위한 함수
--    get_referral_subtree를 래핑하여 depth >= 1 (본인 제외) 카운트만 반환
CREATE OR REPLACE FUNCTION get_total_referral_count(
  root_user_id UUID,
  max_depth INT DEFAULT 10
)
RETURNS INT
LANGUAGE sql STABLE
AS $$
  SELECT COUNT(*)::INT
  FROM get_referral_subtree(root_user_id, max_depth)
  WHERE depth >= 1;
$$;
