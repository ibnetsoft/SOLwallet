-- =============================================
-- DEX MINER BOT — Add referral_code column
-- Migration: 002_add_referral_code.sql
-- =============================================
--
-- 목적:
--   1. users 테이블에 referral_code (TEXT UNIQUE) 컬럼 추가
--   2. 기존 유저들에게 8자리 랜덨 코드 일괄 발급
--
-- 실행 방법:
--   Supabase Dashboard → SQL Editor → 본 파일 붙여넣기 → Run
-- =============================================

-- 1. referral_code 컬럼 추가 (없을 경우만)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- 2. UNIQUE 인덱스 생성 (중복 코드 방지)
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users(referral_code) WHERE referral_code IS NOT NULL;

-- 3. 기존 유저 중 referral_code가 없는 유저에게 8자리 코드 일괄 발급
--    대문자 + 숫자 조합 (혼동되는 문자 0/O, 1/I/L 제외)
DO $$
DECLARE
  u RECORD;
  new_code TEXT;
  charset TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  FOR u IN SELECT id FROM users WHERE referral_code IS NULL LOOP
    LOOP
      -- 8자리 랜덤 코드 생성
      new_code := '';
      FOR i IN 1..8 LOOP
        new_code := new_code || substr(charset, floor(random() * length(charset) + 1)::int, 1);
      END LOOP;

      -- 중복 확인 후 업데이트
      BEGIN
        UPDATE users SET referral_code = new_code WHERE id = u.id AND referral_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- 중복 시 재생성 (루프 계속)
        CONTINUE;
      END;
    END LOOP;
  END LOOP;
END $$;

-- 4. 검증 쿼리 (참고용 — 실행 후 결과 확인)
-- SELECT id, username, referral_code FROM users ORDER BY created_at DESC LIMIT 10;
