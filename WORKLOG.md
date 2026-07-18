# 🔥 DEX MINER BOT — 전체 작업 내역

> **프로젝트:** DEX MINER BOT (Solana 지정가 거래 텔레그램 미니앱)
> **리포지토리:** https://github.com/ibnetsoft/SOLwallet
> **작성일:** 2026-07-18
> **작성자:** ibnetsoft <kimseddang@naver.com>

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [아키텍처](#2-아키텍처)
3. [기술 스택](#3-기술-스택)
4. [디렉토리 구조](#4-디렉토리-구조)
5. [데이터베이스 스키마](#5-데이터베이스-스키마)
6. [구현 기능 상세](#6-구현-기능-상세)
7. [Git 커밋 이력](#7-git-커밋-이력)
8. [환경 변수 안내](#8-환경-변수-안내)
9. [배포 체크리스트](#9-배포-체크리스트)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. 프로젝트 개요

**DEX MINER BOT**은 Solana 블록체인 기반 DEX(분산 거래소)에서 **지정가(Limit Order)** 및 **시장가(Market Order)** 거래를 지원하는 Telegram 미니앱입니다.

### 핵심 기능

| 기능 | 설명 |
|------|------|
| 🏠 **홈 대시보드** | 총 자산, SOL 실시간 가격/변동률, 보유 자산 목록, ROI 차트 |
| 📊 **거래** | 지정가/시장가 주문, 토큰 선택, 수량/가격 입력 |
| 📜 **입출금 내역** | 전체/매수/매도 필터, 거래 내역 조회 |
| ⚙️ **설정** | 지갑 관리(생성/가져오기), 추천인 시스템, 앱 정보 |
| 🔐 **지갑** | 클라이언트 사이드 AES-256-GCM 암호화, 시드구문 생성/임포트 |
| 🎁 **추천인 시스템** | 8자리 추천코드 자동 발급, Telegram 딥링크 + 웹 URL 지원 |
| 🛡️ **인증** | Telegram WebApp initData HMAC-SHA256 서명 검증, JWT 토큰 |

---

## 2. 아키텍처

### 모노레포 구성

```
pnpm workspaces + Turborepo
├── apps/server   (NestJS API — 포트 3000)
├── apps/mini-app (Next.js 미니앱 — 포트 3001)
├── apps/admin    (Next.js 어드민 — 포트 3002)
├── packages/config        (@solwallet/config — 공통 상수)
└── packages/shared-types (@solwallet/shared-types — TypeScript 인터페이스)
```

### 데이터 흐름

```
Telegram App → Mini App (Next.js) → API Server (NestJS) → Supabase (PostgreSQL)
                                   → Jupiter Price API (SOL 가격)
                                   → Manifest.trade (DEX 거래)
```

---

## 3. 기술 스택

### Backend — `apps/server`

| 기술 | 용도 |
|------|------|
| NestJS 11 | API 프레임워크 |
| Passport + JWT | 인증 |
| Supabase Client | PostgreSQL 데이터베이스 |
| Telegraf | Telegram 봇 연동 |
| class-validator | DTO 검증 |
| Multer | 파일 업로드 |
| @nestjs/throttler | Rate Limiting |

### Mini App — `apps/mini-app`

| 기술 | 용도 |
|------|------|
| Next.js 14 (App Router) | 프론트엔드 프레임워크 |
| React 18 | UI 라이브러리 |
| Tailwind CSS 3 | 스타일링 |
| Zustand 5 | 상태 관리 |
| TanStack React Query | 데이터 패칭 |
| Solana web3.js + tweetnacl + bip39 | Solana 지갑 |
| lucide-react | 아이콘 라이브러리 |

### Admin — `apps/admin`

| 기술 | 용도 |
|------|------|
| Next.js 14 (App Router) | 어드민 대시보드 |
| TanStack React Table | 테이블/필터 |
| Tailwind CSS 3 | 스타일링 |

### 인프라

| 기술 | 용도 |
|------|------|
| Supabase | PostgreSQL + Storage |
| Jupiter Price API V3 | SOL USD 실시간 가격 |
| Manifest.trade | DEX 거래 실행 |

---

## 4. 디렉토리 구조

```
SOLwallet/
├── .env                          # 루트 환경변수
├── .env.example                  # 환경변수 템플릿
├── package.json                  # 루트 package.json (모노레포)
├── pnpm-workspace.yaml           # 워크스페이스 설정
├── turbo.json                    # Turborepo 파이프라인
│
├── apps/
│   ├── mini-app/                 # Telegram 미니앱 (포트 3001)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx              # 홈 대시보드
│   │   │   │   ├── layout.tsx            # 루트 레이아웃
│   │   │   │   ├── globals.css           # 전역 스타일
│   │   │   │   ├── login/page.tsx        # 로그인 (Telegram 인증)
│   │   │   │   ├── trade/page.tsx        # 거래 (지정가/시장가)
│   │   │   │   ├── transactions/page.tsx # 입출금 내역
│   │   │   │   └── settings/page.tsx     # 설정
│   │   │   ├── components/
│   │   │   │   ├── BottomNav.tsx         # 하단 네비게이션 (4페이지 공통)
│   │   │   │   ├── Sparkline.tsx         # SVG 라인 차트 (그라데이션)
│   │   │   │   ├── Toast.tsx             # 토스트 알림
│   │   │   │   ├── DepositModal.tsx      # 입금 모달
│   │   │   │   ├── WithdrawModal.tsx     # 출금 모달
│   │   │   │   ├── PinModal.tsx          # PIN 입력
│   │   │   │   ├── MnemonicDisplay.tsx  # 시드구문 표시
│   │   │   │   ├── SeedInput.tsx         # 시드구문 임포트
│   │   │   │   └── Skeleton.tsx          # 로딩 스켈레톤
│   │   │   ├── stores/
│   │   │   │   ├── useWalletStore.ts     # 지갑 상태 (Zustand)
│   │   │   │   └── useTradeStore.ts      # 거래 상태 (orderType: limit/market)
│   │   │   ├── lib/
│   │   │   │   ├── api/
│   │   │   │   │   ├── client.ts         # HTTP 클라이언트
│   │   │   │   │   ├── auth.ts           # 인증 API
│   │   │   │   │   ├── balance.ts        # 잔액 API
│   │   │   │   │   ├── orders.ts         # 주문 API
│   │   │   │   │   ├── price.ts          # SOL 가격 API (Jupiter)
│   │   │   │   │   ├── tokens.ts         # 토큰 API
│   │   │   │   │   ├── user.ts           # 유저 API
│   │   │   │   │   └── withdraw.ts       # 출금 API
│   │   │   │   ├── hooks/
│   │   │   │   │   └── useRoi.ts         # ROI 계산 훅 (localStorage)
│   │   │   │   ├── wallet/
│   │   │   │   │   ├── create.ts         # 지갑 생성
│   │   │   │   │   ├── encrypt.ts        # AES-256-GCM 암호화
│   │   │   │   │   ├── decrypt.ts        # 복호화
│   │   │   │   │   ├── import.ts         # 시드구문 임포트
│   │   │   │   │   ├── sign.ts           # 트랜잭션 서명
│   │   │   │   │   └── transfer.ts       # SOL/토큰 전송
│   │   │   │   ├── manifest/client.ts    # Manifest.trade DEX 클라이언트
│   │   │   │   ├── referral.ts           # 추천인 링크 생성 유틸
│   │   │   │   ├── tokenLogo.ts          # 토큰 로고 URL 생성
│   │   │   │   └── storage.ts            # localStorage 유틸
│   │   │   └── types/
│   │   │       └── telegram.d.ts         # Telegram WebApp 타입 선언
│   │   └── .env.local                    # 미니앱 환경변수
│   │
│   ├── server/                   # 백엔드 API (포트 3000)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── auth/                     # 인증 모듈
│   │       │   ├── auth.controller.ts    # POST /api/auth/telegram, /dev
│   │       │   ├── auth.service.ts       # initData 검증, JWT 발급
│   │       │   └── auth.guard.ts         # JWT 가드
│   │       ├── user/                     # 유저 모듈
│   │       │   ├── user.service.ts      # upsertUser, 추천코드 생성/조회
│   │       │   └── user.controller.ts   # GET /api/user/profile
│   │       ├── wallet/                   # 지갑 모듈
│   │       ├── tokens/                   # 토큰 모듈
│   │       ├── orders/                   # 주문 모듈
│   │       ├── balance/                  # 잔액 모듈
│   │       ├── withdraw/                 # 출금 모듈
│   │       ├── admin/                    # 어드민 모듈
│   │       │   ├── admin.controller.ts   # POST /api/admin/tokens/logo
│   │       │   ├── admin.service.ts      # Supabase Storage 로고 업로드
│   │       │   └── admin.guard.ts        # 어드민 인증 가드
│   │       ├── supabase/                 # Supabase 연결 모듈
│   │       ├── telegram/                 # Telegram 봇 모듈
│   │       └── common/                   # 공통 DTO, 필터, 인터페이스
│   │
│   └── admin/                    # 어드민 대시보드 (포트 3002)
│       └── src/
│           ├── app/
│           │   ├── page.tsx              # 대시보드 (통계)
│           │   ├── login/page.tsx        # 어드민 로그인
│           │   ├── tokens/page.tsx       # 토큰 관리 (로고 업로드)
│           │   ├── transactions/page.tsx # 거래 내역 관리
│           │   └── users/page.tsx        # 유저 관리
│           ├── components/
│           │   ├── AdminAppShell.tsx     # 어드민 레이아웃
│           │   └── AdminSidebar.tsx      # 사이드바
│           └── lib/api/
│               ├── client.ts
│               ├── auth.ts
│               └── admin.ts
│
├── packages/
│   ├── config/src/index.ts       # 공통 상수 (수수료, 최대지갑, RPC 등)
│   └── shared-types/src/index.ts # TypeScript 인터페이스 (User, Order, Wallet 등)
│
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql    # 초기 스키마 (users, wallets, tokens, orders, referrals)
    │   └── 002_add_referral_code.sql # 추천코드 컬럼 추가 + 기존 유저 일괄 발급
    ├── seed.sql                       # 시드 데이터
    └── setup.sql                      # Supabase 설정
```

---

## 5. 데이터베이스 스키마

### 테이블 목록

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|-----------|
| `users` | 회원 | id, telegram_uid, username, first_name, referral_code, referred_by, created_at |
| `wallets` | 지갑 (최대 3개/유저) | id, user_id, public_key, wallet_index(0~2), label, is_active |
| `tokens` | 어드민 등록 토큰 | id, mint_address, symbol, decimals, is_active |
| `orders` | 주문 | id, user_id, wallet_id, token_id, side(buy/sell), order_type(limit), price, quantity, status |
| `referrals` | 추천인 트래킹 | id, referrer_id, referee_id, created_at |

### ER 관계

```
users 1──N wallets     (ON DELETE CASCADE)
users 1──N orders      (ON DELETE CASCADE)
users 1──N referrals   (referrer_id)
users 1──N referrals   (referee_id)
wallets 1──N orders    (ON DELETE CASCADE)
tokens  1──N orders
users ← users         (referred_by FK → users.id, 자기 추천 방지)
```

---

## 6. 구현 기능 상세

### 6.1 홈 대시보드 (`/`)

- **총 잔액**: 소수점 5자리 (`toFixed(5)`), 실시간 업데이트
- **SOL 가격**: Jupiter Price API V3 (`lite-api.jup.ag/price/v3`) 연동
  - 실시간 USD 가격 + 24시간 변동률
  - "Solana Network" 텍스트 + 초록색 점 표시
- **지갑 영역**: SOL 가격 박스 / 지갑 주소 박스 분리 (2개 라운드 박스)
- **보유 자산**: AssetRow 컴포넌트
  - 토큰 로고 (Supabase Storage → `img onError` 시 첫 글자 폴백)
  - 토큰명, 수량, USD 가치
  - 하루 기준 변동률 (0%는 회색 표시)
- **ROI 차트**: 순수 SVG Sparkline (외부 차트 라이브러리 없음)
  - localStorage 기반 30분 간격 스냅샷
  - 상승=초록 그라데이션, 하락=빨강 그라데이션
  - `startOffset`으로 시작 위치 조정
- **BUY/SELL 버튼**: `text-center` 적용

### 6.2 거래 페이지 (`/trade`)

- **지정가/시장가 탭**: 기본값 지정가, 탭 전환 UI
- **시장가 모드**: 가격 입력 숨김, 현재가 자동 동기화
- **토큰 선택**: 활성 토큰 목록
- **주문 입력**: 수량/가격, 총액 자동 계산
- `useTradeStore`에서 `orderType: 'limit' | 'market'` 상태 관리

### 6.3 입출금 내역 (`/transactions`)

- 전체/매수/매도 필터 탭
- 거래 내역 리스트 표시

### 6.4 설정 페이지 (`/settings`)

- **지갑 관리**: 단일 행 레이아웃 (라벨 + 주소 + [활성화][삭제])
  - 새 지갑 생성, 시드구문 임포트 (최대 3개)
- **추천인 섹션**: (헤더 없이 본문만)
  - 내 추천 코드 (8자리) + 복사 버튼
  - 복사 내용: 코드 + Telegram 링크 + 웹 링크 함께 복사
  - 초대한 친구 수, 내 추천인 정보
- **앱 정보**: (헤더 없이 본문만)

### 6.5 하단 네비게이션 (BottomNav)

- 4페이지 공통 컴포넌트 (`src/components/BottomNav.tsx`)
- `usePathname()`으로 활성 탭 자동 감지
- lucide-react 흰색 아이콘: `Home`, `BarChart3`, `ArrowLeftRight`, `Settings`

### 6.6 로그인 / 인증

- Telegram WebApp `initData` 서명 검증 (HMAC-SHA256)
- JWT 토큰 발급 (7일 만료)
- 개발용 `/api/auth/dev` 엔드포인트 지원
- `initDataUnsafe.start_param`으로 추천코드 자동 수신

### 6.7 추천인 시스템

- **코드 생성**: 8자리 대문자+숫자 (혼동 문자 `0/O/1/I/L` 제외)
  - `REFERRAL_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`
- **자동 발급**: 신규 유저 가입 시 `referral_code` 자동 생성
- **기존 유저 보정**: 코드 누락 시 자동 보정 발급
- **링크 형식**:
  - Telegram 딥링크: `https://t.me/<bot>?startapp=<code>`
  - 웹 URL: `https://<miniapp>/?ref=<code>`
- **자동 연결**: 로그인 시 `start_param` / `?ref=`에서 추천코드 추출 → API 전달
- **자기 추천 방지**: referrer 조회 시 본인 ID 제외
- **복사 형식**:
  ```
  DEX MINER BOT 추천 링크
  코드: K7M3X9PQ
  Telegram: https://t.me/<bot>?startapp=K7M3X9PQ
  웹: https://<miniapp>/?ref=K7M3X9PQ
  ```

### 6.8 토큰 로고 시스템

- **업로드**: 어드민 → `POST /api/admin/tokens/logo`
  - Multer FileInterceptor, 2MB 제한, PNG/JPG/WebP
- **저장**: Supabase Storage `token-logos` 버킷 (공개)
  - 파일명: `{symbol.lowercase()}.png` (덮어쓰기)
- **표시**: 지갑 화면에서 `img` → `onError` 시 첫 글자 폴백
- **캐시 무효화**: `?v=timestamp` 쿼리 파라미터

### 6.9 지갑 암호화

- **알고리즘**: AES-256-GCM
- **키 유도**: PBKDF2 (600,000 iterations, SHA-512)
- **PIN 기반**: 최소 6자리, 5분 자동 잠금
- **범위**: 클라이언트 사이드 전용 (서버에 평문 비밀키 없음)

---

## 7. Git 커밋 이력

### 2026-07-18

| 해시 | 메시지 | 내용 |
|------|--------|------|
| `efa1f58` | feat(mini-app): 홈 대시보드 전면 재디자인 | 총 잔액, SOL 가격/변동률, 보유 자산, Sparkline, ROI 훅, Jupiter API 연동 |
| `a4f70e4` | refactor(mini-app): 홈 UI 7가지 디테일 수정 | Solana Network, SOL 접두사, 박스 분리, 소수점 5자리, 보라색 박스 제거 등 |
| `b70f614` | feat: 토큰 로고 이미지 업로드 기능 (Supabase Storage) | 어드민 로고 업로드, balance API logoUrl 추가, 첫 글자 폴백 |
| `37af1f2` | style(mini-app): 하단 네비 아이콘 흰색 lucide line으로 변경 | Home, BarChart3 아이콘 교체 |
| `6ea14e0` | refactor(mini-app): 공통 BottomNav 컴포넌트로 4페이지 통일 | 중복 코드 제거, usePathname 활성 탭 감지 |
| `2414ded` | feat(mini-app): 시장가 주문 지원 + 이모지 정리 | 지정가/시장가 탭, orderType 상태, 📈📉⚙️ 제거 |
| `db7fc89` | refactor(mini-app): 설정 페이지 단순화 | 4개 섹션 헤더 제거, 지갑 행 단일 행, 서브 설명 제거 |
| `b5827a6` | fix(mini-app): 추천인/앱 정보 섹션 본문 복구 | (정정) 헤더 텍스트만 제거, 본문 유지 |
| `e20440b` | style(mini-app): 앱 정보에서 최대지갑/수수료 항목 제거 | "최대 지갑 3개", "수수료 1%" 텍스트 제거 |
| `873896d` | feat: 추천인 시스템 구현 (링크 클릭 → 자동 추천인 연결) | DB migration, 8자리 코드 생성, start_param/ref 추출, 설정 복사 |

---

## 8. 환경 변수 안내

### 루트 `.env` (서버용)

```env
TELEGRAM_BOT_TOKEN=       # Telegram 봇 토큰
SUPABASE_URL=             # Supabase 프로젝트 URL
SUPABASE_ANON_KEY=        # Supabase 익명 키
SUPABASE_SERVICE_KEY=     # Supabase 서비스 롤 키
SOLANA_RPC_URL=           # Solana RPC 엔드포인트
MANIFEST_BASE_URL=        # Manifest.trade API URL
ADMIN_SECRET=             # 어드민 인증 비밀키
MINI_APP_URL=             # 미니앱 공개 URL
ADMIN_APP_URL=            # 어드민 공개 URL
SERVER_PORT=3000          # 서버 포트
NODE_ENV=development      # 환경
```

### 미니앱 `apps/mini-app/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_SUPABASE_URL=https://yvnxbalfktdxhlcbftax.supabase.co
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=    # Telegram 봇 username (필수)
NEXT_PUBLIC_MINI_APP_URL=http://localhost:3001
```

---

## 9. 배포 체크리스트

### 필수 (Must)

- [ ] Supabase SQL Editor에서 `001_initial_schema.sql` 실행
- [ ] Supabase SQL Editor에서 `002_add_referral_code.sql` 실행
- [ ] Supabase Storage에 `token-logos` 공개 버킷 생성
- [ ] `.env` 파일에 모든 환경변수 입력
- [ ] `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` 설정

### 선택 (Optional)

- [ ] `NEXT_PUBLIC_MINI_APP_URL`을 실제 배포 URL로 변경
- [ ] ngrok 고정 도메인 설정 (로컬 테스트용)
- [ ] AWS App Runner 배포

---

## 10. Troubleshooting

### `Cannot find module './xxx.js'` — 빌드 캐시 충돌

**원인**: dev 서버 실행 중 프로덕션 빌드를 실행하거나, 좀비 프로세스残留

**해결**:
```bash
# 1. 포트 프로세스 종료
netstat -ano | findstr ":3001"     # Windows
taskkill /PID <pid> /F

# 2. 캐시 삭제
rm -rf apps/mini-app/.next apps/mini-app/node_modules/.cache

# 3. dev 서버 재시작
cd apps/mini-app && npx next dev --port 3001
```

> ⚠️ dev 서버가 실행 중일 때 `next build`를 실행하지 마세요.

### `EADDRINUSE: address already in use :::3000` — 포트 중복

**해결**:
```bash
# Windows
netstat -ano | findstr ":3000"
taskkill /PID <pid> /F

# Git Bash
lsof -ti:3000 | xargs kill -9
```

### TypeScript 에러 (`TS18046`, `TS2448`, `TS2694`, `TS2353`)

- **TS2694**: `pnpm add -D @types/multer` (타입 패키지 누락)
- **TS2353**: 매개변수 이름 변경 시 호출부도 함께 업데이트
- **TS18046**: 변수 선언 순서 정렬
- **TS2448**: 로컬 컴포넌트와 라이브러리 import 충돌 → 별칭 사용 (`as`)

---

## 📌 참고

- **Telegram 미니앱 실행 환경**: Telegram 인앱 WebView (크로미움 기반 자체 브라우저)
- **Telegram 딥링크**: `https://t.me/<bot>?startapp=<code>` → `initDataUnsafe.start_param` 자동 전달
- **지갑 암호화**: 서버에 평문 키 저장하지 않음 (클라이언트 사이드 전용)
- **토큰 로고**: DB 스키마 의존성 없이 파일 이름 규칙 기반 (`{symbol}.png`)
- **Package Manager**: pnpm@10.34.5, Node >= 20.0.0
