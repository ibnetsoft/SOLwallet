# AoiWallet — Manifest DEX 거래 아키텍처

## 개요

AoiWallet은 Solana 기반 DEX인 **Manifest**를 사용하여 토큰 거래를 처리합니다. Manifest는 온체인 orderbook 기반 DEX로, Solana의 Serum/OpenBook 계열과 유사한 구조를 가집니다.

## 1. Manifest 거래 구조

### 1.1 주문 생명주지

```
사용자 주문 → Manifest API(tx 생성) → 클라이언트 서명 → 온체인 제출
                                                    ↓
                                              orderbook 등록 (tx 성공 ≠ 체결)
                                                    ↓
                                              Crank 실행 시 매칭
                                                    ↓
                                              체결(Filled) → Vault에 토큰 보관
                                                    ↓
                                              Withdraw → 사용자 지갑(ATA)로 입금
```

### 1.2 핵심: tx 성공 ≠ 체결

| 단계 | 의미 | 상태 |
|---|---|---|
| tx 블록 포함 | orderbook에 주문 등록 완료 | `active` |
| Crank 매칭 | 매수/매도 주문이 매칭됨 | `filled` |
| Withdraw | Vault에서 지갑으로 토큰 인출 | 완료 |

> **중요:** Manifest 주문은 tx가 성공해도 orderbook에 등록만 된 것입니다. 실제 체결(filled)은 별도의 crank 프로세스가 매칭을 실행해야 발생합니다.

### 1.3 Crank 기반 매칭

- Manifest는 **Crankless = No** — crank 필요
- Crank(keeper)가 `batchUpdate` instruction을 실행해야 매칭 발생
- Manifest.trade 운영팀이 crank를 주기적으로 실행
- 주문이 만료(expired)되기 전에 crank가 돌아야 체결됨

### 1.4 Vault 보관 모델

Manifest는 AMM(Raydium 등)과 달리 **명시적 withdraw** 필요:

| DEX 타입 | 체결 후 | withdraw |
|---|---|---|
| AMM (Raydium) | 자동으로 ATA 입금 | 불필요 |
| Orderbook (Manifest) | Vault에 보관 | **필요** |

- **Vault**: Manifest 프로그램이 제어하는 온체인 계정 (CEX와 다름, 프로그램이 보관)
- 사용자는 언제든 private key로 withdraw tx 서명 가능
- Serum, OpenBook 등 Solana orderbook DEX들도 동일한 방식

### 1.5 주문 타입

| 타입 | 설명 | Manifest 파라미터 |
|---|---|---|
| `limit` | 지정가. 만료까지 orderbook에 머뭄 | `orderType: "limit"` |
| `timeInForce` | 지정가 + 슬롯 만료 시간 | `orderType: "timeInForce"`, `expirySlots` |
| `reverse` | 체결 후 반대편 주문 자동 생성 (AMM 복제) | `orderType: "reverse"`, `spreadBps` |
| `global` | 글로벌 계정 기반, 마켓 간 자본 효율 | `orderType: "global"` |

> **참고:** Manifest HTTP API는 `immediateOrCancel`을 지원하지 않습니다. 시장가 주문은 `timeInForce` + `expirySlots`로 구현합니다.

## 2. SOL/USDT 거래 설정

### 2.1 마켓 정보

| 항목 | 값 |
|---|---|
| 마켓 주소 | `BCn7bK9AURs4dVunxgRjjBnn6kGwGjEc1v7dQDrSQY88` |
| Base 토큰 | SOL (`So11111111111111111111111111111111111111112`) |
| Quote 토큰 | USDT (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`) |

### 2.2 USDC → USDT 마이그레이션

의뢰인이 자체 토큰을 **USDT 페어**로 상장하기로 결정하여, 모든 거래 페어를 USDC에서 USDT로 변경했습니다.

**변경 파일:**
- `apps/server/src/orders/orders.service.ts` — 모든 `quoteMint`를 `USDT_MINT`로 통일
- `apps/server/src/price/price.service.ts` — SOL/USDT 오더북에서 가격 조회
- `apps/server/src/transfers/transfers.service.ts` — USDC_MINT 로컬 참조 정리
- `apps/mini-app/src/app/trade/page.tsx` — Quote 통화 USDT 고정

## 3. 시장가 주문 구현

### 3.1 Manifest에서 시장가 구현

Manifest는 시장가 주문을 직접 지원하지 않으므로, 극단 가격으로 지정가 주문을 넣어 즉시 매칭되도록 합니다:

```typescript
if (dto.orderType === 'market') {
  // 매도: 모든 매수 호가보다 낮은 가격 → 즉시 매칭
  // 매수: 모든 매도 호가보다 높은 가격 → 즉시 매칭
  orderPrice = dto.side === 'sell' ? 0.01 : 999999;
}
```

### 3.2 expirySlots

```typescript
orderType: 'timeInForce',
expirySlots: 150,  // ≈ 60초 후 자동 만료
```

- `expirySlots: 3` → 약 1.2초 (너무 짧음, AlreadyExpired 에러)
- `expirySlots: 150` → 약 60초 (안정적)

## 4. 자동 Withdraw

### 4.1 동작 흐름

```
주문 체결(filled) → OrderStatusService 감지 (10s 폴링)
                         ↓
              fetchOrderHistory에서 새 filled 감지
                         ↓
              autoWithdrawIfPossible() 실행
                         ↓
              지갑 unlock 상태 → PIN 없이 자동 withdraw
              지갑 locked 상태 → skip (수동 withdraw 필요)
                         ↓
              Manifest vault → 사용자 USDT ATA로 자동 입금
```

### 4.2 구현 위치

- **서버**: `apps/server/src/orders/orders.service.ts` — `getWithdrawTx()` + `submitWithdrawTx()`
- **클라이언트**: `apps/mini-app/src/stores/useTradeStore.ts` — `autoWithdrawIfPossible()`
- **트리거**: `fetchOrderHistory()`에서 새로운 `filled` 주문 감지 시

### 4.3 주의사항

- 자동 withdraw는 거래 세션(지갑 unlock 상태)에서만 동작
- 앱을 닫았다 다시 열면 수동으로 withdraw 버튼 클릭 필요
- withdraw 버튼은 Trade 페이지의 Open Orders 섹션에 표시 유지

## 5. Wrapper & Setup

### 5.1 Wrapper란?

Manifest는 `Wrapper` 프로그램을 통해 사용자 계정을 관리합니다:
- seat 관리, clientOrderId, insufficient funds 자동 처리 등
- 모든 Manifest API 호출에 `setupIxs: true` 필수

### 5.2 setupIxs 문제

초기에는 `setupIxs: true`가 누락되어 여러 문제 발생:
- 취소: "setup ixs need to be executed first" 에러
- 주문 등록: wrapper 미초기화로 deposit이 vault에만 들어가고 추적 불가

### 5.3 수정

모든 Manifest HTTP API 호출에 `setupIxs: true` 추가:
```typescript
body: JSON.stringify({
  maker: walletPublicKey,
  baseMint: token.mint_address,
  quoteMint: quoteMint,
  orders: [{ size, price, side, orderType, clientOrderId }],
  computeUnitPrice: MANIFEST.computeUnitPrice,
  setupIxs: true,  // 항상 포함
}),
```

## 6. 출금 (SOL 전송)

### 6.1 아키텍처

```
클라이언트: buildSolTransferTx(from, to, amount)
    → SystemProgram.transfer instruction 포함 tx 생성
    → 클라이언트에서 서명 (legacy)
    → 서버에 제출

서버: sendTransaction (skipPreflight: true)
    → confirmTransaction으로 실제 블록 포함 확인
    → DB transfers 테이블에 기록
```

### 6.2 새 계정 출금

Solana에서 처음 SOL을 받는 계정(0 lamports)은 rent 예치금(890,880 lamports ≈ 0.00089 SOL) 필요:
- 잔액이 있는 기존 계정 → 소액도 가능
- 새 계정(0 lamports) → 최소 0.00089 SOL 필요

### 6.3 수수료 처리

MAX 출금 시 0.001 SOL을 수수료/rent 예치금으로 남김:
```typescript
const maxWithdrawable = Math.max(0, solBalance - 0.001);
```

## 7. Fill 감지

### 7.1 방식

OrderStatusService가 10초마다 폴링하여 체결 여부 확인:

```typescript
// 1. submitted → active (tx가 블록에 포함됨)
// 2. active → filled (tx logs에서 fillDiscriminant 매칭)
```

### 7.2 fillDiscriminant

- `@cks-systems/manifest-sdk/dist/cjs/fillFeed`에서 import
- 값: `3ae6f2034b7104a9` (8 bytes)
- tx logs의 Program data와 비교하여 fill event 감지

### 7.3 주문 상태 DB

```sql
-- orders 테이블 상태
status: submitted | active | filled | expired | cancelled | failed
```

## 8. 전체 파일 구조

```
┌─ Server ──────────────────────────────────────────┐
│ orders.service.ts         주문 생성/취소/withdraw │
│ order-status.service.ts    fill 감지 폴링 (10s)    │
│ order-status.scheduler.ts  cron 스케줄러           │
│ withdraw.service.ts        SOL 출금 + DB 기록      │
│ transfers.service.ts       히스토리 (RPC + DB)     │
│ price.service.ts          SOL/USDT 가격 조회       │
└─────────────────────────────────────────────────────┘

┌─ Client ──────────────────────────────────────────┐
│ stores/useTradeStore.ts   주문/취소/자동 withdraw │
│ lib/api/orders.ts         API 클라이언트           │
│ lib/wallet/transfer.ts    SOL 전송 tx 빌드        │
│ app/trade/page.tsx        거래 UI                  │
├───────────────────────────────────────────────────┤
│ app/transactions/page.tsx  히스토리 + Solscan 링크 │
│ components/WithdrawModal.tsx SOL 출금 모달         │
└─────────────────────────────────────────────────────┘
```

## 9. API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/orders/withdraw-tx` | POST | Manifest withdraw tx 생성 |
| `/api/orders/withdraw/submit` | POST | withdraw tx 제출 + 컨펌 |
| `/api/withdraw` | POST | SOL 외부 지갑 전송 |
| `/api/transfers` | GET | 히스토리 (DB + RPC) |
| `/api/orders` | POST | 주문 생성 (Manifest) |
| `/api/orders/fresh-tx` | POST | 만료 주문 재전송 |
| `/api/orders/cancel` | DELETE | 주문 취소 |

## 10. Supabase 마이그레이션

| 파일 | 설명 | 상태 |
|---|---|---|
| `005_order_type_market.sql` | orders 테이블 market 타입 허용 | ✅ 실행됨 |
| `006_transfers_table.sql` | transfers 테이블 생성 | ✅ 실행됨 |

## 11. 알려진 이슈 & 해결됨

| 이슈 | 원인 | 해결 |
|---|---|---|
| tx 성공인데 체결 안 됨 | orderbook 등록만 된 것 | `filled` 상태 분리 |
| 취소 "setup ixs" 에러 | setupIxs 누락 | 모든 호출에 `setupIxs: true` |
| AlreadyExpired (0x7) | expirySlots=3 너무 짧음 | expirySlots=150 |
| 시장가 체결 안 됨 | 가격 > best bid | 극단 가격 사용 |
| 출금 "insufficient funds" | 수신 주소가 새 계정 | rent 예치금 안내 |
| 출금 tx 미반영 | skipPreflight:true + confirm 없음 | confirmTransaction 추가 |
| 히스토리 누락 | RPC rate limit (413) | DB transfers 테이블 |
| wrapper deposit 유실 | wrapper 미초기화 | setupIxs:true로 해결 (기존 유출 복구 불가) |
