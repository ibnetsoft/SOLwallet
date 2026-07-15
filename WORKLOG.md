# 🔥 DEX MINER BOT — 개발 진행 로그

> **프로젝트:** DEX MINER BOT (Solana 지정가 거래 텔레그램 미니앱)
> **리포지토리:** https://github.com/ibnetsoft/SOLwallet
> **작성일:** 2026-07-16

---

## 목차

- [Day 1~2: 인프라 구축](#day-12-인프라-구축)
- [Day 3~5: Supabase 마이그레이션 + 지갑 모듈](#day-35-supabase-마이그레이션--지갑-모듈)
- [Day 6~8: 거래 기능 (Manifest.trade 연동 + 잔액 조회)](#day-68-거래-기능-manifesttrade-연동--잔액-조회)
- [Day 9~10: Admin 대시보드](#day-910-admin-대시보드)
- [프로젝트 전체 구조](#프로젝트-전체-구조)

---

## Day 1~2: 인프라 구축

> **커밋:** `b1a75a1` feat: initialize monorepo
> **커밋:** `788eea4` feat: add project README and comprehensive development guide

### 구현 내용

#### 모노레포 기반 구축

pnpm workspaces + Turborepo 기반의 모노레포 아키텍처를 구축했습니다.

| 패키지 | 포트 | 역할 |
|--------|------|------|
| `apps/server` | 3000 | NestJS 백엔드 + Telegram Bot |
| `apps/mini-app` | 3001 | Next.js 14 미니앱 (Telegram WebApp) |
| `apps/admin` | 3002 | Next.js 14 관리자 대시보드 |
| `packages/shared-types` | — | TypeScript 공유 타입 |
| `packages/config` | — | 공통 상수/설정 |

#### NestJS 서버 초기 설정

| 파일 | 내용 |
|------|------|
| `apps/server/src/main.ts` | CORS (MINI_APP_URL + ADMIN_APP_URL), Global Prefix `api`, `/health` 엔드포인트 |
| `apps/server/src/app.module.ts` | ConfigModule (global), SupabaseModule, TelegramModule, AuthModule, UserModule, WalletModule |
| `apps/server/nest-cli.json` | webpack mode 활성화 |
| `apps/server/tsconfig.json` | `@solwallet/*` 경로 별칭, rootDir 제거 + include 확장 |

#### Telegram Bot 기본 연동

| 파일 | 내용 |
|------|------|
| `telegram/telegram.service.ts` | `/start` 명령 → 유저 upsert → 환영 메시지 + 인라인 키보드 |
| `telegram/telegram.module.ts` | UserModule 임포트 |

#### Supabase 연동

| 파일 | 내용 |
|------|------|
| `supabase/supabase.module.ts` | `@Global()` 모듈, `createClient()` |
| `supabase/supabase.service.ts` | `getClient()` 메서드로 SupabaseClient 제공 |

#### 인증 시스템

| 파일 | 내용 |
|------|------|
| `auth/auth.service.ts` | Telegram HMAC-SHA256 서명 검증, JWT 토큰 발급 |
| `auth/auth.controller.ts` | `POST /api/auth/telegram` — initData 검증 → upsert → JWT |
| `auth/auth.guard.ts` | Bearer JWT 검증 가드 |

#### 유저/지갑 API (스켈레톤)

| 파일 | 엔드포인트 |
|------|-----------|
| `user/user.controller.ts` | `GET /user/profile`, `GET /user/wallets` |
| `wallet/wallet.controller.ts` | `POST /wallets/register`, `PATCH /wallets/:id/activate`, `DELETE /wallets/:id` |

#### Mini-App 초기 설정

| 파일 | 내용 |
|------|------|
| `mini-app/next.config.js` | `transpilePackages: ['@solana/web3.js', 'bip39', 'tweetnacl', 'bs58']` |
| `mini-app/tailwind.config.js` | 커스텀 컬러 (primary indigo, solana, success, danger) |
| `mini-app/src/app/page.tsx` | 홈 화면 (지갑 영역, 자산, 거래 배너, 보유 자산) |
| `mini-app/src/app/trade/page.tsx` | 거래 화면 스켈레톤 |
| `mini-app/src/app/settings/page.tsx` | 설정 화면 스켈레톤 |

#### 공유 패키지

| 파일 | 내용 |
|------|------|
| `packages/shared-types/src/index.ts` | User, Wallet, Token, Order, CreateOrderDto, Referral, Portfolio, Orderbook, ApiResponse, PaginatedResponse |
| `packages/config/src/index.ts` | FEE_RATE (1%), MAX_WALLETS (3), BASE_CURRENCY (USDT), MANIFEST baseUrl, WALLET_ENCRYPTION 설정 |

#### Supabase DB 스키마 (5개 테이블)

| 테이블 | 컬럼 | 설명 |
|--------|------|------|
| `users` | id, telegram_uid, username, first_name, last_name, referred_by, timestamps | 회원 |
| `wallets` | id, user_id, public_key, wallet_index, label, is_active, created_at | 지갑 (최대 3개) |
| `tokens` | id, mint_address, symbol, decimals, is_active, created_at | 관리자 등록 토큰 |
| `orders` | id, user_id, wallet_id, token_id, side, price, quantity, fee, status, tx_signature, timestamps | 지정가 주문 |
| `referrals` | id, referrer_id, referee_id, created_at | 추천인 |

---

## Day 3~5: Supabase 마이그레이션 + 지갑 모듈

> **커밋:** `a736ac7` feat: Day 3-5 Supabase 마이그레이션 + 지갑 모듈 완성

### 구현 내용

#### Supabase SQL 세팅

| 파일 | 내용 |
|------|------|
| `supabase/setup.sql` | 병합 마이그레이션 + 시드 + 트리거 (Supabase Dashboard SQL Editor에서 수동 실행용) |
| `supabase/migrations/001_initial_schema.sql` | 5개 테이블 DDL |
| `supabase/seed.sql` | 초기 토큰 데이터 (SOL, USDT 등 — mainnet mint address) |

#### Mini-App — 로컬 지갑 모듈 (On-Device)

모든 개인키 조작은 클라이언트에서 수행되며, 서버는 공개키만 알고 있습니다.

| 파일 | 기능 |
|------|------|
| `lib/wallet/helpers.ts` | `deriveKeypairFromSeed()` — tweetnacl로 Keypair 생성 |
| `lib/wallet/create.ts` | `createWallet()` — bip39 니모닉 생성 → Keypair 도출 |
| `lib/wallet/import.ts` | `importSeedPhrase()` — 기존 니모닉으로 지갑 복구 |
| `lib/wallet/encrypt.ts` | `encryptPrivateKey()` — PBKDF2 → AES-256-GCM 암호화 |
| `lib/wallet/decrypt.ts` | `decryptPrivateKey()` — 암호화된 키 복호화 |
| `lib/wallet/sign.ts` | `signTransaction()` — Keypair로 트랜잭션 서명 후 메모리 해제 |
| `lib/wallet/index.ts` | barrel export |

**암호화 방식:**
- 알고리즘: AES-256-GCM
- 키 도출: PBKDF2 (100,000 iterations, SHA-256)
- 솔트: 랜덤 16 bytes
- PIN 기반 키 파생

#### Mini-App — 스토리지

| 파일 | 기능 |
|------|------|
| `lib/storage.ts` | `StoredWallet` 타입, localStorage 기반 CRUD, auth token 관리 |

#### Mini-App — 상태 관리 (Zustand)

| 파일 | 기능 |
|------|------|
| `stores/useWalletStore.ts` | 지갑 생성/가입/삭제, 활성화 전환, PIN 잠금/잠금해제, 서버 동기화 |

#### Mini-App — UI 컴포넌트

| 파일 | 기능 |
|------|------|
| `components/PinModal.tsx` | 숫자 키패드 PIN 입력 (2단계 확인), 도트 시각화 |
| `components/SeedInput.tsx` | 니모닉 입력 + 검증 + 클립보드 붙여넣기 + 보안 경고 |
| `components/MnemonicDisplay.tsx` | 생성된 니모닉 표시/숨김 토글 + 복사 + 보안 경고 |

#### Mini-App — 설정 페이지 완성

`settings/page.tsx` 전체 구현:
- 지갑 목록 표시 + 활성 지갑 하이라이트
- 새 지갑 생성 → 니모닉 백업 모달 → PIN 설정
- 시드 프레이즈 임포트 → PIN 설정
- 지갑 활성화 전환
- 지갑 삭제 (PIN 확인)

#### 빌드 에러 수정 이력

| 에러 | 원인 | 수정 |
|------|------|------|
| `TS6059: File is not under rootDir` | `@solwallet/shared-types` 모듈 해석 실패 | server tsconfig에서 `rootDir` 제거, `include` 확장 |
| `webpack ts-loader missing` | nest-cli.json webpack=true | `ts-loader`, `webpack-node-externals` devDependency 추가 |
| `@solana/bip39` 404 | 패키지 존재하지 않음 | `bip39` 패키지로 교체 |
| `bip39` no default export | ESM/CJS 호환 | `import * as bip39 from 'bip39'` |
| `Uint8Array` not assignable to `BufferSource` | TypeScript strict mode | `.buffer as ArrayBuffer` 캐스팅 |
| SWC parse error | `declare global` in layout.tsx | `types/telegram.d.ts`로 분리 |
| `actionLoading string not assignable to boolean` | 타입 불일치 | `disabled={!!actionLoading}` |
| Manifest API Key | API Key 필요 없음 확인 | `MANIFEST_API_KEY` 제거, `MANIFEST_BASE_URL`로 교체 |

---

## Day 6~8: 거래 기능 (Manifest.trade 연동 + 잔액 조회)

> **커밋:** `92124e5` feat: Day 6-8 거래 기능 구현

### 구현 내용

#### NestJS — Orders 모듈

| 파일 | 내용 |
|------|------|
| `orders/orders.module.ts` | OrdersController + OrdersService |
| `orders/orders.service.ts` | DB 주문 CRUD + Manifest API unsigned tx 요청 + Solana RPC 제출 |
| `orders/orders.controller.ts` | 주문 생성/제출/취소/조회 엔드포인트 |

**엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| `POST /api/orders` | 주문 생성 — DB 저장 + Manifest unsigned tx 반환 |
| `POST /api/orders/:id/submit` | 서명된 트랜잭션 Solana RPC로 전송 |
| `POST /api/orders/:id/cancel` | 주문 취소 — Manifest DELETE + DB 업데이트 |
| `GET /api/orders/active` | 활성 주문 목록 |
| `GET /api/orders/history` | 과거 주문 내역 |
| `GET /api/orderbook/:tokenMint` | Manifest 오더북 프록시 |

**주문 플로우:**
```
Client → POST /api/orders (tokenId, side, price, quantity)
Server → DB orders 테이블 저장 + Manifest API unsigned tx 요청
Server → unsigned tx + 주문 ID 응답
Client → signTransaction() 온디바이스 서명
Client → POST /api/orders/:id/submit { signedTx }
Server → Solana RPC sendTransaction 제출
Server → DB 업데이트 (tx_signature, status)
```

#### NestJS — Balance 모듈

| 파일 | 내용 |
|------|------|
| `balance/balance.module.ts` | BalanceController + BalanceService |
| `balance/balance.service.ts` | RPC `getBalance` (SOL), `getTokenAccountsByOwner` (SPL), 포트폴리오 계산 |
| `balance/balance.controller.ts` | `GET /balance/:walletAddress`, `GET /balance` (포트폴리오) |

#### NestJS — Tokens 모듈

| 파일 | 내용 |
|------|------|
| `tokens/tokens.module.ts` | TokensController + TokensService |
| `tokens/tokens.service.ts` | DB `tokens` 테이블 활성 토큰 조회 |
| `tokens/tokens.controller.ts` | `GET /tokens` (JwtAuthGuard) |

#### Mini-App — API 클라이언트

| 파일 | 내용 |
|------|------|
| `lib/api/client.ts` | `apiFetch<T>` — Bearer token 자동 첨부, `ApiResponse<T>` 래핑 |
| `lib/api/orders.ts` | createOrder, submitOrder, cancelOrder, getActiveOrders, getOrderHistory |
| `lib/api/balance.ts` | getWalletBalance, getPortfolio |
| `lib/api/tokens.ts` | getTokens |

#### Mini-App — Manifest 클라이언트

| 파일 | 내용 |
|------|------|
| `lib/manifest/client.ts` | `fetchOrderbook()`, `fetchCurrentPrice()` — 공개 API 직접 호출 |

> Manifest.trade는 **공개 API**이므로 API Key 없이 브라우저에서 직접 호출 가능.

#### Mini-App — Trade Store (Zustand)

| 파일 | 내용 |
|------|------|
| `stores/useTradeStore.ts` | BUY/SELL 토글, 토큰 선택, 가격/수량, 오더북, 주문 관리 |

**상태:** side, selectedToken, price, quantity, orderbook, currentPrice, tokens, activeOrders, orderHistory, isSubmitting

**액션:** fetchTokens, fetchOrderbook, fetchCurrentPrice, fetchActiveOrders, createAndSubmitOrder (unlockWallet → sign → submit → lockWallet), cancelOrder

#### Mini-App — Trade 페이지 UI

`trade/page.tsx` 전체 구현:
- **BUY/SELL 토글** — 초록/빨간색 탭
- **토큰 선택 드롭다운** — API 목록 기반
- **지정가 입력** — 수동 입력 + **최근가 버튼**
- **수량 입력** — 25%/50%/75%/100% 빠른 비율 버튼
- **주문 요약** — 수량 × 가격, 1% 수수료 자동 계산 표시
- **실행 버튼** → PIN 모달 → 온디바이스 서명 → 제출
- **활성 주문** — 목록 + 취소 버튼

---

## Day 9~10: Admin 대시보드

> **커밋:** `f471ebb` feat: Admin 대시보드 완성 (서버 + 프론트엔드)

### 구현 내용

#### 서버 — Admin 인증

| 파일 | 내용 |
|------|------|
| `auth/auth.service.ts` | `validateAdminSecret()`, `generateAdminToken()` 추가 — ADMIN_SECRET 검증 후 `role: 'admin'` JWT 발급 |
| `auth/auth.controller.ts` | `POST /api/auth/admin` — `{ secret }` → JWT 토큰 반환 |
| `admin/admin.guard.ts` | `AdminGuard` — JWT 검증 + `payload.role === 'admin'` 확인 |

#### 서버 — Admin Module

| 파일 | 내용 |
|------|------|
| `admin/admin.module.ts` | AdminController + AdminService |
| `admin/admin.service.ts` | 대시보드 통계, 유저/토큰/주문 CRUD |
| `admin/admin.controller.ts` | 관리자 전용 엔드포인트 |

**Admin 엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| `GET /api/admin/stats` | 대시보드 통계 (총 유저, 오늘 가입, 수수료, 주문) |
| `GET /api/admin/users` | 유저 목록 (페이지네이션) |
| `GET /api/admin/users/:id/wallets` | 특정 유저 지갑 상세 |
| `GET /api/admin/tokens` | 토큰 목록 |
| `POST /api/admin/tokens` | 토큰 등록 (mintAddress, symbol, decimals) |
| `PATCH /api/admin/tokens/:id` | 토큰 활성화/비활성화 토글 |
| `GET /api/admin/orders` | 전체 주문 내역 (상태/토큰 필터, 페이지네이션) |

#### 공유 타입 확장

`packages/shared-types/src/index.ts`에 추가:

| 타입 | 용도 |
|------|------|
| `AdminStats` | totalUsers, todaySignups, totalFeeRevenue, totalOrders, activeOrders |
| `AdminUserDetail` | id, telegramUid, username, firstName, lastName, referredBy, walletCount, createdAt |
| `AdminTokenDetail` | id, mintAddress, symbol, decimals, isActive, createdAt |
| `AdminOrderDetail` | id, userId, username, tokenSymbol, side, price, quantity, fee, status, txSignature, createdAt |

#### Admin 프론트엔드 — 설정

| 파일 | 변경 |
|------|------|
| `package.json` | `@solwallet/shared-types`, `@solwallet/config` 워크스페이스 의존성 |
| `tsconfig.json` | `@solwallet/*` 경로 별칭, include 확장 |
| `tailwind.config.js` | 커스텀 컬러 (primary, solana, success, danger) — 미니앱과 통일 |
| `.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:3000/api` |
| `globals.css` | 다크 테마 CSS 변수 (bg-primary: #111827) |
| `layout.tsx` | 서버 컴포넌트 (metadata) + `AdminAppShell` 클라이언트 래퍼 |
| `components/AdminAppShell.tsx` | 인증 상태 관리, 미인증 시 `/login` 자동 리다이렉트 |

#### Admin 프론트엔드 — API 클라이언트

| 파일 | 내용 |
|------|------|
| `lib/api/client.ts` | `apiFetch<T>` — Bearer token (admin_auth_token) 자동 첨부, 401 시 login 리다이렉트 |
| `lib/api/auth.ts` | `adminLogin(secret)`, `adminLogout()`, `getAdminToken()` |
| `lib/api/admin.ts` | getStats, getUsers, getUserWallets, getTokens, createToken, toggleToken, getOrders |

#### Admin 프론트엔드 — 로그인 페이지

| 파일 | 내용 |
|------|------|
| `app/login/page.tsx` | Admin Secret 입력 → JWT 발급 → localStorage 저장 → `/` 리다이렉트 |

#### Admin 프론트엔드 — 대시보드

| 파일 | 기능 |
|------|------|
| `app/page.tsx` | 5개 통계 카드 (총 유저, 오늘 가입, 수수료, 총 주문, 활성 주문) + 퀵 링크 |
| `app/users/page.tsx` | 유저 테이블 + 페이지네이션 + 지갑 상세 패널 (펼치기/접기) |
| `app/tokens/page.tsx` | 등록 폼 (CA, 심볼, decimals) + 토큰 테이블 + 활성/비활성 토글 |
| `app/transactions/page.tsx` | 주문 테이블 + 상태/토큰 필터 드롭다운 + Solscan 링크 + 페이지네이션 |
| `components/AdminSidebar.tsx` | 네비게이션 + 로그아웃 버튼 |

#### 테마 변경

기존 admin은 **라이트 테마** (`bg-white` 카드)였으나, 미니앱과 통일하여 **다크 테마** (`bg-gray-800/50`, `bg-gray-900`)로 전환했습니다.

---

## 프로젝트 전체 구조

```
SOLwallet/
├── README.md                          # 프로젝트 소개
├── WORKLOG.md                         # 📖 이 문서 (개발 진행 로그)
├── DEVELOPMENT_GUIDE.md               # 개발 기획서 & 길라잡이
├── .env.example                       # 환경변수 템플릿
├── turbo.json                         # Turborepo 설정
├── package.json                       # Root (pnpm workspace)
├── pnpm-workspace.yaml                # workspace 정의
├── tsconfig.base.json                 # 공유 TS 설정
│
├── apps/
│   ├── server/                        # 🤖 NestJS 백엔드 (port 3000)
│   │   ├── src/
│   │   │   ├── main.ts                # CORS, Global Prefix
│   │   │   ├── app.module.ts          # 전체 모듈 등록
│   │   │   ├── admin/                 # 관리자 모듈
│   │   │   │   ├── admin.module.ts
│   │   │   │   ├── admin.controller.ts
│   │   │   │   ├── admin.service.ts
│   │   │   │   └── admin.guard.ts
│   │   │   ├── auth/                  # 인증 (Telegram + Admin)
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── auth.guard.ts
│   │   │   ├── user/                  # 유저 CRUD
│   │   │   ├── wallet/                # 지갑 관리
│   │   │   ├── orders/                # 주문 (Manifest 연동)
│   │   │   ├── balance/               # 잔액 조회 (Solana RPC)
│   │   │   ├── tokens/                # 토큰 목록
│   │   │   ├── supabase/              # Supabase 클라이언트
│   │   │   ├── telegram/              # Telegram Bot
│   │   │   └── common/                # 공통 인터페이스
│   │   └── nest-cli.json
│   │
│   ├── mini-app/                      # 📱 Telegram 미니앱 (port 3001)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx           # 홈
│   │   │   │   ├── trade/page.tsx     # 거래
│   │   │   │   └── settings/page.tsx  # 설정
│   │   │   ├── components/            # PinModal, SeedInput, MnemonicDisplay
│   │   │   ├── lib/
│   │   │   │   ├── api/               # API 클라이언트
│   │   │   │   ├── manifest/          # Manifest API 클라이언트
│   │   │   │   ├── wallet/            # 🔑 로컬 지갑 모듈
│   │   │   │   └── storage.ts         # localStorage 관리
│   │   │   ├── stores/                # Zustand (wallet, trade)
│   │   │   └── types/                 # Telegram 타입 선언
│   │   └── tailwind.config.js
│   │
│   └── admin/                         # 🛠️ 관리자 대시보드 (port 3002)
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── login/page.tsx     # 관리자 로그인
│       │   │   ├── page.tsx           # 대시보드
│       │   │   ├── users/page.tsx     # 회원 관리
│       │   │   ├── tokens/page.tsx    # 토큰 관리
│       │   │   └── transactions/     # 트랜잭션 모니터링
│       │   ├── components/             # AdminSidebar, AdminAppShell
│       │   └── lib/api/               # API 클라이언트 + auth
│       └── tailwind.config.js
│
├── packages/
│   ├── shared-types/src/index.ts      # 공유 TypeScript 타입
│   └── config/src/index.ts            # 공통 상수/설정
│
└── supabase/
    ├── setup.sql                      # 통합 마이그레이션 + 시드 + 트리거
    ├── migrations/001_initial_schema.sql
    └── seed.sql                       # 초기 토큰 데이터
```

---

## API 엔드포인트 전체 목록

### 인증

| Method | Path | 설명 | Guard |
|--------|------|------|-------|
| `POST` | `/api/auth/telegram` | Telegram initData → JWT | 없음 |
| `POST` | `/api/auth/admin` | Admin Secret → JWT | 없음 |

### 유저/지갑

| Method | Path | 설명 | Guard |
|--------|------|------|-------|
| `GET` | `/api/user/profile` | 내 프로필 | JwtAuthGuard |
| `GET` | `/api/user/wallets` | 내 지갑 목록 | JwtAuthGuard |
| `POST` | `/api/wallets/register` | 지갑 공개키 등록 | JwtAuthGuard |
| `PATCH` | `/api/wallets/:id/activate` | 활성 지갑 변경 | JwtAuthGuard |
| `DELETE` | `/api/wallets/:id` | 지갑 삭제 | JwtAuthGuard |

### 거래

| Method | Path | 설명 | Guard |
|--------|------|------|-------|
| `POST` | `/api/orders` | 주문 생성 → unsigned tx 반환 | JwtAuthGuard |
| `POST` | `/api/orders/:id/submit` | 서명된 트랜잭션 제출 | JwtAuthGuard |
| `POST` | `/api/orders/:id/cancel` | 주문 취소 | JwtAuthGuard |
| `GET` | `/api/orders/active` | 활성 주문 | JwtAuthGuard |
| `GET` | `/api/orders/history` | 과거 주문 | JwtAuthGuard |
| `GET` | `/api/orderbook/:tokenMint` | 오더북 (Manifest 프록시) | JwtAuthGuard |

### 잔액/토큰

| Method | Path | 설명 | Guard |
|--------|------|------|-------|
| `GET` | `/api/balance/:walletAddress` | 지갑 잔액 (SOL + SPL) | JwtAuthGuard |
| `GET` | `/api/balance` | 포트폴리오 | JwtAuthGuard |
| `GET` | `/api/tokens` | 활성 토큰 목록 | JwtAuthGuard |

### 관리자

| Method | Path | 설명 | Guard |
|--------|------|------|-------|
| `GET` | `/api/admin/stats` | 대시보드 통계 | AdminGuard |
| `GET` | `/api/admin/users` | 유저 목록 (페이지네이션) | AdminGuard |
| `GET` | `/api/admin/users/:id/wallets` | 유저 지갑 상세 | AdminGuard |
| `GET` | `/api/admin/tokens` | 토큰 목록 | AdminGuard |
| `POST` | `/api/admin/tokens` | 토큰 등록 | AdminGuard |
| `PATCH` | `/api/admin/tokens/:id` | 토큰 활성/비활성 | AdminGuard |
| `GET` | `/api/admin/orders` | 전체 주문 (필터) | AdminGuard |

---

## 환경변수 목록

```env
# Telegram
TELEGRAM_BOT_TOKEN=xxx

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx

# Solana
SOLANA_RPC_URL=https://rpc.helius.xyz/?api-key=xxx

# Manifest.trade (공개 API — API Key 불필요)
MANIFEST_BASE_URL=https://manifest-orders.fly.dev/v1

# Admin
ADMIN_SECRET=your-secure-admin-secret

# App URLs
MINI_APP_URL=http://localhost:3001
ADMIN_APP_URL=http://localhost:3002
SERVER_PORT=3000
NODE_ENV=development
```

---

## 빌드 상태

| 패키지 | 상태 | 마지막 확인 |
|--------|------|------------|
| `apps/server` | ✅ 통과 | `f471ebb` |
| `apps/mini-app` | ✅ 통과 | `f471ebb` |
| `apps/admin` | ✅ 통과 | `f471ebb` |
