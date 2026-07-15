# 🔥 DEX MINER BOT — 솔라나 지정가 거래 텔레그램 미니앱

## 최종 개발 기획서 & 개발 길라잡이 (Development Guide)

> **버전:** v1.0  
> **의뢰인:** 곽민  
> **작성일:** 2026-07-15  
> **프로젝트명:** DEX MINER BOT  
> **리포지토리:** https://github.com/ibnetsoft/SOLwallet

---

## 목차 (Table of Contents)

1. [프로젝트 개요](#1-프로젝트-개요)
2. [핵심 개발 원칙](#2-핵심-개발-원칙)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [화면별 기능 정의](#4-화면별-기능-정의)
5. [백엔드 및 인프라 설계](#5-백엔드-및-인프라-설계)
6. [어드민 페이지 명세](#6-어드민-페이지-명세)
7. [14일 개발 일정](#7-14일-개발-일정)
8. [기술 스택 요약](#8-기술-스택-요약)
9. [DB 스키마 설계](#9-db-스키마-설계)
10. [API 엔드포인트 명세](#10-api-엔드포인트-명세)
11. [보안 가이드라인](#11-보안-가이드라인)
12. [프로젝트 폴더 구조](#12-프로젝트-폴더-구조)
13. [환경 설정 가이드](#13-환경-설정-가이드)
14. [체크리스트](#14-체크리스트)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **프로젝트명** | DEX MINER BOT |
| **유형** | 솔라나 지정가 거래 전용 텔레그램 미니앱 |
| **의뢰인** | 곽민 |
| **개발 목적** | Manifest.trade API를 연동하여, 사용자가 본인의 안전한 로컬 지갑을 통해 어드민이 직접 등록해 둔 토큰들을 지정가 주문(Limit Order)으로 손쉽게 거래하고, 자산과 추천인 상태를 확인할 수 있는 초경량 미니앱 구축 |

### 핵심 특징

- **로컬 지갑 방식:** 개인키를 사용자 디바이스(온디바이스)에 암호화 저장하여 서명 처리
- **지정가 전용:** 오더북 기반의 Limit Buy / Limit Sell만 지원 (AMM 스왑 제외)
- **중앙 토큰 관리:** 어드민이 등록한 안전한 토큰만 노출
- **텔레그램 미니앱:** Telegram Bot + WebApp 형태로 모바일 최적화

---

## 2. 핵심 개발 원칙

> ⚠️ **아래 원칙들은 프로젝트 전반에 걸쳐 엄격히 준수해야 합니다.**

### 2.1 스왑(Swap) 제외

- AMM 방식의 스왑 기능은 **구현하지 않습니다.**
- 오직 오더북 기반의 **지정가 매수/매도(Limit Buy / Limit Sell)** 기능만 제공합니다.
- UI/UX, API, SDK 연동 모두 이 원칙을 따릅니다.

### 2.2 CA 파싱 즉시 거래 제외

- 유저가 외부 토큰 주소(Contract Address)를 붙여넣어 임의로 거래하는 스펙을 **배제합니다.**
- 거래 가능한 토큰은 어드민이 중앙 관리하는 화이트리스트에 등록된 토큰만입니다.

### 2.3 가스비 표시 제외

- UI 내 **실시간 가스비 표시 기능을 제외**합니다.
- 온체인 가스 트래킹 리소스를 절약하여 앱 성능을 최적화합니다.

### 2.4 중앙식 토큰 노출

- 어드민이 등록해 둔 안전한 토큰(A코인, B코인, USDT, SOL 등)만 화면에 노출합니다.
- 사용자가 임의의 토큰을 추가하거나 조회할 수 없습니다.
- 기본 기축 통화는 **USDT**로 고정합니다.

### 2.5 온디바이스 서명 원칙

- 모든 트랜잭션 서명은 **사용자의 디바이스(로컬)** 에서 수행됩니다.
- 서명된 트랜잭션만 솔라나 네트워크(RPC 노드)로 전송합니다.
- 개인키는 서버로 전송되지 않습니다.

---

## 3. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│                        TELEGRAM BOT (NestJS)                      │
│  /start → 회원가입 → 추천인 관계 기록 → 웹뷰 주소 전송              │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                   MINI APP (Next.js - WebApp)                     │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  홈(HOME) │  │ 거래(BUY) │  │ 거래(SELL)│  │  설정    │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │              │                │
│  ┌────┴─────────────┴─────────────┴──────────────┴────┐           │
│  │            로컬 지갑 모듈 (On-Device)              │           │
│  │  - 지갑 생성 / Import / 전환 (최대 3개)           │           │
│  │  - 암호화 개인키 저장                               │           │
│  │  - 트랜잭션 로컬 서명 (Signing)                    │           │
│  └─────────────────────────────────────────────────┘            │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│   NestJS API    │ │  Supabase    │ │  Manifest.trade  │
│   (Backend)     │ │  (Database)  │ │  (DEX SDK/RPC)   │
│                 │ │              │ │                  │
│ - 유저 관리    │ │ - users      │ │ - 오더북 조회    │
│ - 토큰 관리    │ │ - wallets    │ │ - 지정가 주문    │
│ - 주문 관리    │ │ - tokens     │ │ - 주문 취소      │
│ - 수수료 처리  │ │ - orders     │ │ - 체결 처리      │
└─────────────────┘ └──────────────┘ └──────────────────┘
```

---

## 4. 화면별 기능 정의

### 4.1 메인 화면 (Home)

> 세로 스크롤 최적화 모바일 화면

#### 4.1.1 상단 웰컴 및 지갑 영역

| 기능 | 설명 |
|------|------|
| **지갑 주소 노출** | 현재 활성화된 솔라나 지갑 주소 표시 (예: `7xYp...k9Qm`) |
| **클립보드 복사** | 지갑 주소 1-tap 복사 버튼 |
| **가스비 표시** | ❌ 제외 (설계 원칙에 따라) |

#### 4.1.2 전체 자산 잔고 (USDT 환산)

| 기능 | 설명 |
|------|------|
| **총 자산 가치** | 보유 모든 토큰(SOL, USDT, 어드민 등록 토큰) 가치 합산 큰 글씨 표시 |
| **실시간 ROI** | 손익률(%) 표시 |
| **누적 P&L** | 누적 손익금액 표시 |

#### 4.1.3 입출금 퀵 버튼

| 버튼 | 동작 |
|------|------|
| **입금 (Deposit)** | 입금용 솔라나 주소 복사 + QR코드 팝업 출력 |
| **출금 (Withdraw)** | 수신 주소 + 수량 입력 → 온디바이스 서명 → 송금 |

#### 4.1.4 지갑 전환/관리

- 최대 **3개 지갑** 간 빠른 전환 (체인지)
- **신규 지갑 생성** 팝업
- **시드구문 Import** 팝업 (기존 지갑 복구)

#### 4.1.5 트레이딩 진입 배너

```
┌──────────────────────────────┐
│     🚀 토큰 거래하러 가기      │
│  [ BUY ]        [ SELL ]     │
└──────────────────────────────┘
```

- 클릭 시 거래 탭으로 바로 이동

#### 4.1.6 보유 자산 목록 (My Holdings)

| 항목 | 설명 |
|------|------|
| **노출 대상** | 어드민이 중앙 등록한 토큰 목록 (SOL, USDT, FACT 등) |
| **보유 수량** | 사용자가 보유한 각 토큰 수량 |
| **현재 가치** | 실시간 USDT 환산 가치 |

---

### 4.2 거래 화면 (Buy / Sell — Limit Order 전용)

#### 4.2.1 모드

| 설정 | 값 |
|------|------|
| **거래 모드** | Limit Order (지정가 주문) 전용 |
| **Market Swap** | ❌ 제외 |
| **일반 Swap** | ❌ 제외 |

#### 4.2.2 대상 토큰 선택

- 어드민이 사전 등록한 토큰 리스트만 선택 가능
- 기본 기축 통화: **USDT** 고정

#### 4.2.3 지정가 가격 입력 (Price)

| 기능 | 설명 |
|------|------|
| **가격 수동 입력** | 목표 가격(USDT 단위) 수동 입력란 |
| **최근가 버튼** | 클릭 시 Manifest API 기준 현재 체결 가격 자동 입력 |

#### 4.2.4 수량 및 금액 입력 (Amount)

| 기능 | 설명 |
|------|------|
| **수량 입력** | 매수/매도 토큰 수량 직접 입력 |
| **퀵 비율 버튼** | 25% / 50% / 75% / 100% 슬라이더 제공 |
| **총 주문 금액** | 차감될 총 금액(USDT) 자동 계산 노출 |
| **수수료 표기** | 기본 거래 수수료 **1%** 적용된 최종 지불 금액 출력 |

#### 4.2.5 주문 실행 플로우

```
[토큰명 매수 주문하기 (Limit)] 버튼 클릭
    │
    ▼
미니앱 내부 로컬 영역 (On-Device)
    │
    ├─ 1. 개인키 암호화 해제 (로컬)
    ├─ 2. 트랜잭션 빌드 (Manifest SDK)
    ├─ 3. 트랜잭션 서명 (로컬 Signing)
    │
    ▼
서명된 트랜잭션 → Solana RPC 노드 → 네트워크 전송
    │
    ▼
주문 등록 완료 → UI 결과 업데이트
```

#### 4.2.6 주문 이력 및 체결 현황

| 기능 | 설명 |
|------|------|
| **Active Limits** | 미체결 지정가 주문 목록 |
| **Cancel** | 각 주문별 취소 버튼 제공 |
| **체결 이력** | 체결 완료된 주문 히스토리 |

---

## 5. 백엔드 및 인프라 설계

### 5.1 텔레그램 봇 & 미니앱 진입 (NestJS)

```
사용자가 /start 입력
    │
    ├─ 신규 유저 → 회원가입 처리
    │   ├─ Telegram UID 저장
    │   ├─ 추천인(레퍼럴) 관계 기록 (URL 파라미터 startapp=referee_uid)
    │   └─ 웹뷰(미니앱) 주소 포함 환영 메시지 전송
    │
    └─ 기존 유저 → 로그인 처리
        └─ 웹뷰 주소 재전송 (버튼 형태)
```

### 5.2 데이터베이스 및 API (Supabase)

- **회원/지갑 테이블:** Telegram UID, 암호화 지갑 주소, 추천인 UID
- **어드민 토큰 등록 테이블:** Mint 주소, 심볼, 소수점 자리수
- **주문 데이터:** 오더 이력, 거래 수수료(1%) 내역

### 5.3 Manifest.trade SDK / RPC 연동

- **SDK:** `@cks-systems/manifest-sdk` 라이브러리 활용
- **기능:** Manifest 지정가 오더북 조회 및 트랜잭션 빌더 연결
- **RPC:** 고성능 솔라나 RPC 노드 서비스를 백엔드에 바인딩하여 안전한 체결 처리

---

## 6. 어드민 페이지 명세 (Next.js)

### 6.1 회원 목록 관리 (최우선 기능 ⭐)

| 기능 | 설명 |
|------|------|
| **유저 잔고 조회** | 가입 유저별 지갑 주소 단위로 A코인, B코인, USDT, SOL 잔고 실시간 리스트업 |
| **방장 7일 실적** | 특정 방장 회원이 가입시킨 하위 유저 숫자 트래킹 |
| **자동 집계** | "지난 7일(7d) 동안 가입시킨 신규 하위 유저 수"를 날짜별/방장별로 실시간 자동 계산 (수동 공수 제로화) |

### 6.2 중앙 토큰 관리

| 기능 | 설명 |
|------|------|
| **토큰 등록** | 신규 토큰의 스마트 컨트랙트(CA) 등록 폼 |
| **토큰 삭제** | 기존 등록 토큰 제거 기능 |
| **필드** | CA(Mint Address), Symbol, Decimals, 활성 여부 |

### 6.3 레퍼럴 및 트랜잭션 관리 (우선순위 낮음)

| 기능 | 설명 |
|------|------|
| **가입 트리 조회** | 유저 가입상황 트리 구조 시각화 |
| **수수료 대장** | 수수료 적립 내역 로그 |
| **Tx 모니터링** | 거래 트랜잭션 해시(Tx Hash) 목록 모니터링 |

---

## 7. 14일 개발 일정

> ✅ **14일 만에 구현이 가능한 이유:**  
> "토큰간 직접 스왑(Swap)", "사용자 임의 CA 파싱 거래", "실시간 가스비 트래킹"이 설계에서 완전히 제거되어 개발 스펙이 매우 심플해집니다. Supabase의 강력한 내장 기능과 NestJS의 안정성, Manifest SDK를 활용하면 충분히 가능합니다.

### 7.1 타임라인 상세 계획표

| 기간 | 개발 영역 | 주요 태스크 | 마일스톤 |
|------|-----------|-------------|----------|
| **1~2일차** | 인프라 및 DB | • Supabase DB 스키마 구축 (회원, 지갑, 토큰, 레퍼럴 테이블)<br>• 솔라나 RPC 노드 서비스 가입 및 환경 세팅<br>• NestJS 텔레그램 봇 기본 서버 구동 및 /start 진입 흐름 완료 | 🏁 인프라 Ready |
| **3~5일차** | 지갑 및 미니앱 Core | • Next.js 기반 모바일 최적화 웹뷰 화면 템플릿 (홈, 거래, 설정)<br>• 온디바이스 지갑 생성 / Import / 전환 (최대 3개)<br>• 로컬 암호화 저장 방식 및 트랜잭션 로컬 서명 모듈 개발 | 🏁 지갑 모듈 완료 |
| **6~8일차** | DEX API 연동 | • Manifest.trade SDK 연동 — 지정 토큰 오더북 실시간 조회<br>• Limit Buy / Limit Sell 및 주문 취소 API 연결<br>• 수수료 1% 비즈니스 로직 적용 | 🏁 거래 기능 완료 |
| **9~11일차** | 어드민 웹 | • 회원 목록 및 유저별 잔고 조회 테이블<br>• 방장용 7일 하위 가입 유저 수 집계 대시보드<br>• 스마트 컨트랙트(CA) 등록/제거 관리 페이지 | 🏁 어드민 완료 |
| **12~13일차** | 연동 및 최적화 | • 백엔드 ↔ 프론트엔드 ↔ DB 통합 연동<br>• 트랜잭션 결과 실시간 UI 업데이트 및 오류 처리 테스트 | 🏁 전체 연동 완료 |
| **14일차** | 테스트 및 런칭 | • Solana 데브넷에서 테스트 지정가 거래 수행<br>• 수수료 정상 수취 테스트<br>• ✅ 메인넷 정식 배포 | 🚀 런칭 |

### 7.2 Gantt 차트 (시각화)

```
Week 1                                         Week 2
─────────────────────────────────────────────────────────
Day 1  2  3  4  5  6  7  8  9  10  11  12  13  14
─────────────────────────────────────────────────────────
[████████] 인프라 & DB
     [████████████] 지갑 & 미니앱 Core
                    [████████████] DEX API 연동
                              [████████████] 어드민 웹
                                          [████████] 연동 & 최적화
                                                [████] 테스트 & 배포
─────────────────────────────────────────────────────────
```

---

## 8. 기술 스택 요약

| 영역 | 기술 | 버전/비고 |
|------|------|-----------|
| **프론트엔드 (미니앱)** | Next.js (React) | 모바일 최적화 WebApp |
| **프론트엔드 (어드민)** | Next.js | 대시보드 관리 페이지 |
| **백엔드** | NestJS | Telegram Bot + REST API |
| **데이터베이스** | Supabase (PostgreSQL) | 내장 Auth, Realtime |
| **텔레그램** | Telegram Bot API + Mini App SDK | WebApp 진입 |
| **솔라나 지갑** | @solana/web3.js, @solana/spl-token | 로컬 지갑 생성/서명 |
| **DEX SDK** | @cks-systems/manifest-sdk | Manifest 지정가 오더북 |
| **RPC 노드** | Solana RPC (Helius/QuickNode 등) | 고성능 RPC 서비스 |
| **상태 관리** | Zustand / React Context | 미니앱 상태 |
| **스타일링** | Tailwind CSS | 모바일 UI |
| **배포** | Vercel (프론트) / Railway (백엔드) | 협의 후 결정 |

---

## 9. DB 스키마 설계

### 9.1 users (회원 테이블)

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_uid  BIGINT UNIQUE NOT NULL,
  username      TEXT,
  referred_by   UUID REFERENCES users(id),       -- 추천인 UID
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.2 wallets (지갑 테이블)

```sql
CREATE TABLE wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) NOT NULL,
  public_key    TEXT NOT NULL,                    -- 솔라나 지갑 주소
  wallet_index  SMALLINT DEFAULT 0,              -- 0, 1, 2 (최대 3개)
  label         TEXT DEFAULT 'Wallet 1',
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

> ⚠️ **주의:** 개인키(Private Key)는 서버에 저장하지 않습니다. 사용자 디바이스의 로컬 스토리지에 암호화 저장합니다.

### 9.3 tokens (어드민 토큰 등록 테이블)

```sql
CREATE TABLE tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint_address  TEXT UNIQUE NOT NULL,            -- 스마트 컨트랙트 (CA)
  symbol        TEXT NOT NULL,                   -- 토큰 심볼 (예: SOL, USDT, FACT)
  decimals      SMALLINT NOT NULL,               -- 소수점 자리수
  is_active     BOOLEAN DEFAULT TRUE,            -- 미니앱 노출 여부
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.4 orders (주문 테이블)

```sql
CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) NOT NULL,
  wallet_id     UUID REFERENCES wallets(id) NOT NULL,
  token_id      UUID REFERENCES tokens(id) NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type    TEXT NOT NULL DEFAULT 'limit',   -- 'limit' 고정
  price         NUMERIC(18, 6) NOT NULL,         -- 지정가 (USDT)
  quantity      NUMERIC(18, 6) NOT NULL,         -- 수량
  filled_qty    NUMERIC(18, 6) DEFAULT 0,       -- 체결 수량
  fee           NUMERIC(18, 6) DEFAULT 0,        -- 수수료 (1%)
  fee_rate      NUMERIC(5, 4) DEFAULT 0.01,      -- 수수료율 (1%)
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'filled', 'cancelled', 'expired')),
  tx_signature  TEXT,                             -- 솔라나 트랜잭션 서명
  manifest_order_id TEXT,                        -- Manifest 오더 ID
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 9.5 referrals (추천인 트래킹 테이블)

```sql
CREATE TABLE referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID REFERENCES users(id) NOT NULL,   -- 추천인 (방장)
  referee_id    UUID REFERENCES users(id) NOT NULL,   -- 피추천인
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referee_id)
);
```

---

## 10. API 엔드포인트 명세

### 10.1 Auth & User

| Method | Endpoint | 설명 |
|--------|----------|------|
| `POST` | `/api/auth/telegram` | Telegram UID로 인증/가입 처리 |
| `GET` | `/api/user/profile` | 내 프로필 정보 조회 |
| `GET` | `/api/user/wallets` | 내 지갑 목록 조회 |
| `POST` | `/api/user/wallets/register` | 공개키 서버 등록 |

### 10.2 Tokens

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/tokens` | 어드민 등록 활성 토큰 목록 조회 |
| `POST` | `/api/admin/tokens` | 어드민 토큰 등록 |
| `DELETE` | `/api/admin/tokens/:id` | 어드민 토큰 삭제 |

### 10.3 Trading (Manifest)

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/orderbook/:tokenMint` | 특정 토큰 오더북 조회 |
| `GET` | `/api/price/:tokenMint` | 현재 체결가 조회 |
| `POST` | `/api/orders` | 지정가 주문 생성 (서명된 tx 전송) |
| `GET` | `/api/orders/active` | 내 미체결 주문 목록 |
| `POST` | `/api/orders/:id/cancel` | 주문 취소 (서명된 tx 전송) |
| `GET` | `/api/orders/history` | 체결 이력 조회 |

### 10.4 Balance & Portfolio

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/balance/:walletAddress` | 특정 지갑 잔고 조회 |
| `GET` | `/api/portfolio` | 포트폴리오 전체 자산 (USDT 환산) |
| `POST` | `/api/withdraw` | 출금 (서명된 tx 전송) |

### 10.5 Admin

| Method | Endpoint | 설명 |
|--------|----------|------|
| `GET` | `/api/admin/users` | 전체 유저 목록 |
| `GET` | `/api/admin/users/:id/balances` | 특정 유저 잔고 조회 |
| `GET` | `/api/admin/referrals/stats` | 추천인 통계 (7일 집계) |
| `GET` | `/api/admin/transactions` | 전체 트랜잭션 모니터링 |
| `GET` | `/api/admin/revenue` | 수수료 수익 대장 |

---

## 11. 보안 가이드라인

> 🔒 **이 프로젝트의 보안은 사용자의 자산 보호와 직결됩니다.**

### 11.1 개인키 관리 (가장 중요)

- **서버 저장 금지:** 개인키는 절대 서버/DB에 저장하지 않습니다.
- **로컬 암호화:** 사용자 디바이스의 `localStorage` 또는 `IndexedDB`에 AES-256-GCM 방식으로 암호화 저장합니다.
- **암호화 키:** 사용자가 미니앱 접속 시 입력하는 PIN/비밀번호 기반 PBKDF2 유도 키를 사용합니다.
- **메모리 해제:** 서명 완료 후 메모리에서 개인키를 즉시 해제합니다.

### 11.2 트랜잭션 서명

- 모든 서명은 **클라이언트(미니앱)에서 수행**합니다.
- 서버는 서명된 트랜잭션을 RPC 노드로 전달하는 역할만 합니다.
- 서명되지 않은 raw 트랜잭션을 서버로 전송하지 않습니다.

### 11.3 API 보안

- 모든 API 엔드포인트는 **Telegram UID 기반 인증** (JWT)을 사용합니다.
- 어드민 엔드포인트는 **별도 어드민 인증** 레이어를 거칩니다.
- Rate Limiting을 적용하여 무차별 대입 공격을 방지합니다.

### 11.4 환경 변수 관리

```env
# .env.example — 절대 커밋하지 마세요
TELEGRAM_BOT_TOKEN=xxx
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx
SOLANA_RPC_URL=xxx
MANIFEST_API_KEY=xxx
ADMIN_SECRET=xxx
```

---

## 12. 프로젝트 폴더 구조

```
SOLwallet/
├── README.md                    # 프로젝트 소개
├── DEVELOPMENT_GUIDE.md         # 📖 이 문서 (개발 길라잡이)
├── .env.example                 # 환경변수 템플릿
│
├── apps/
│   ├── mini-app/                # 📱 텔레그램 미니앱 (Next.js)
│   │   ├── src/
│   │   │   ├── app/             # Next.js App Router
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx     # Home 화면
│   │   │   │   ├── trade/
│   │   │   │   │   ├── buy/     # 매수 화면
│   │   │   │   │   └── sell/    # 매도 화면
│   │   │   │   └── settings/    # 설정 화면
│   │   │   ├── components/      # 공통 UI 컴포넌트
│   │   │   ├── lib/
│   │   │   │   ├── wallet/      # 🔑 로컬 지갑 모듈
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── import.ts
│   │   │   │   │   ├── encrypt.ts
│   │   │   │   │   └── sign.ts
│   │   │   │   ├── manifest/    # 📊 Manifest SDK 연동
│   │   │   │   ├── api/         # API 클라이언트
│   │   │   │   └── utils/       # 유틸리티
│   │   │   ├── hooks/           # React Hooks
│   │   │   ├── stores/          # 상태 관리 (Zustand)
│   │   │   └── types/           # TypeScript 타입 정의
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── admin/                   # 🛠️ 어드민 페이지 (Next.js)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx     # 대시보드
│   │   │   │   ├── users/       # 회원 관리
│   │   │   │   ├── tokens/      # 토큰 관리
│   │   │   │   └── transactions/ # 트랜잭션 모니터링
│   │   │   ├── components/
│   │   │   └── lib/
│   │   └── package.json
│   │
│   └── server/                  # 🤖 백엔드 (NestJS)
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── auth/
│       │   │   ├── auth.module.ts
│       │   │   ├── auth.controller.ts
│       │   │   └── auth.service.ts
│       │   ├── telegram/
│       │   │   ├── telegram.module.ts
│       │   │   └── telegram.service.ts
│       │   ├── tokens/
│       │   │   ├── tokens.module.ts
│       │   │   └── tokens.service.ts
│       │   ├── orders/
│       │   │   ├── orders.module.ts
│       │   │   ├── orders.controller.ts
│       │   │   └── orders.service.ts
│       │   ├── balance/
│       │   ├── manifest/
│       │   ├── admin/
│       │   └── common/
│       ├── test/
│       └── package.json
│
├── packages/                    # 공유 패키지 (Monorepo)
│   ├── shared-types/            # 공통 TypeScript 타입
│   └── config/                  # 공통 설정
│
├── supabase/                    # 🗄️ Supabase 설정
│   ├── migrations/              # DB 마이그레이션 파일
│   └── seed.sql                 # 초기 데이터 (토큰 등)
│
├── docs/                        # 📚 추가 문서
│   ├── api-spec.md              # API 상세 스펙
│   └── deployment.md            # 배포 가이드
│
├── turbo.json                   # Turborepo 설정
├── package.json                 # Monorepo root
└── pnpm-workspace.yaml          # pnpm workspace
```

---

## 13. 환경 설정 가이드

### 13.1 필수 계정 및 서비스 가입

| 서비스 | 용도 | URL |
|--------|------|-----|
| **Supabase** | 데이터베이스, Auth | https://supabase.com |
| **Solana RPC** | 블록체인 RPC 노드 | Helius / QuickNode / Triton |
| **Telegram Bot** | 봇 토큰 발급 | @BotFather |
| **Manifest.trade** | DEX API Key | https://manifest.trade |
| **Vercel** | 프론트 배포 | https://vercel.com |

### 13.2 로컬 개발 환경 구축

```bash
# 1. Node.js 설치 (v18+)
# 2. pnpm 설치
npm install -g pnpm

# 3. 레포지토리 클론
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet

# 4. 의존성 설치
pnpm install

# 5. 환경변수 설정
cp .env.example .env
# .env 파일에 각 서비스 키 입력

# 6. 백엔드 실행 (개발 모드)
cd apps/server
pnpm dev

# 7. 미니앱 실행 (개발 모드 — 별도 터미널)
cd apps/mini-app
pnpm dev

# 8. 어드민 실행 (개발 모드 — 별도 터미널)
cd apps/admin
pnpm dev
```

---

## 14. 체크리스트

### 14.1 인프라 설정 (Day 1~2)

- [ ] Supabase 프로젝트 생성
- [ ] DB 스키마 (5개 테이블) 마이그레이션
- [ ] Solana RPC 서비스 가입 및 엔드포인트 확보
- [ ] Manifest.trade API Key 발급
- [ ] Telegram Bot 생성 (@BotFather)
- [ ] NestJS 프로젝트 초기화 및 Telegram Bot 서버 연동
- [ ] `/start` 진입 → 웹뷰 주소 전송 흐름 완료

### 14.2 미니앱 (Day 3~5)

- [ ] Next.js 프로젝트 초기화 (Telegram WebApp SDK)
- [ ] Home 화면 UI 구성
- [ ] 로컬 지갑 생성 모듈 (`createWallet`)
- [ ] 로컬 지갑 Import 모듈 (`importSeedPhrase`)
- [ ] 지갑 암호화 저장 (`AES-256-GCM + PBKDF2`)
- [ ] 지갑 전환 기능 (최대 3개)
- [ ] 트랜잭션 로컬 서명 모듈 (`signTransaction`)
- [ ] 입금 QR코드 팝업
- [ ] 출금 UI 및 서명 흐름

### 14.3 거래 기능 (Day 6~8)

- [ ] Manifest SDK 초기화 및 연동
- [ ] 오더북 실시간 조회 UI
- [ ] 현재가(체결가) 조회 API
- [ ] Limit Buy 주문 생성 플로우
- [ ] Limit Sell 주문 생성 플로우
- [ ] 수수료 1% 계산 로직
- [ ] 주문 취소 기능
- [ ] 미체결 주문 목록 UI
- [ ] 체결 이력 UI

### 14.4 어드민 (Day 9~11)

- [ ] 어드민 Next.js 프로젝트 초기화
- [ ] 어드민 인증 (Secret Key 기반)
- [ ] 회원 목록 테이블
- [ ] 유저별 잔고 실시간 조회
- [ ] 방장 7일 하위 가입 유저 수 자동 집계 대시보드
- [ ] 토큰 등록/삭제 관리 페이지
- [ ] 트랜잭션 해시 모니터링
- [ ] 수수료 수익 대장

### 14.5 연동 및 테스트 (Day 12~14)

- [ ] 백엔드 ↔ 프론트엔드 ↔ DB 전체 연동
- [ ] 실시간 데이터 업데이트 (WebSocket / Polling)
- [ ] 에러 핸들링 및 사용자 알림
- [ ] Solana 데브넷 테스트 거래
- [ ] 수수료 수취 검증
- [ ] 메인넷 배포

---

## 부록 A: 추천 라이브러리

| 목적 | 라이브러리 | 설명 |
|------|------------|------|
| 솔라나 웹3 | `@solana/web3.js` | Solana 블록체인 상호작용 |
| SPL 토큰 | `@solana/spl-token` | SPL 토큰 표준 연동 |
| 지갑 생성 | `@solana/web3.js` Keypair | 키쌍 생성 |
| 암호화 | `crypto-js` 또는 Web Crypto API | 개인키 AES 암호화 |
| Manifest DEX | `@cks-systems/manifest-sdk` | 지정가 오더북 연동 |
| QR 코드 | `qrcode.react` | 입금 QR 생성 |
| 상태 관리 | `zustand` | 경량 상태 관리 |
| HTTP 클라이언트 | `ky` 또는 `axios` | API 요청 |
| 모바일 UI | `tailwindcss` + `@headlessui/react` | 모바일 최적화 UI |

---

## 부록 B: 용어 정리

| 용어 | 설명 |
|------|------|
| **Limit Order** | 지정가 주문. 사용자가 원하는 가격을 지정하여 매수/매도하는 방식 |
| **Manifest.trade** | 솔라나 기반 중앙화된 오더북 DEX |
| **On-Device Signing** | 사용자의 기기에서 트랜잭션에 서명하는 방식 (개인키 미전송) |
| **CA (Contract Address)** | 스마트 컨트랙트 주소 (솔라나에서는 Mint Address) |
| **RPC Node** | 블록체인 네트워크와 통신하는 노드 |
| **Referral** | 추천인 시스템. 기존 유저가 신규 유저를 초대하는 구조 |
| **Mini App** | 텔레그램 내에서 실행되는 웹 애플리케이션 |

---

> 📌 **이 문서는 프로젝트의 총체적 길라잡이입니다.**  
> 개발 과정에서 의문이 생기면 이 문서를 먼저 참조하고, 필요시 업데이트하세요.
