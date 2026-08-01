-- =============================================
-- AoiWallet — Admin-only nickname
-- Migration: 007_admin_nickname.sql
-- =============================================
-- 어드민이 회원 식별용으로 붙이는 내부 메모성 닉네임 (주로 방장 관리용)
-- 유저에게는 절대 노출되지 않음 — 어드민 회원목록에서만 조회/수정

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_nickname TEXT;
