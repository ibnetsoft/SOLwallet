# Stale Active 주문 자동 감지 수정

> **날짜:** 2026-08-05
> **커밋:** `89b735c`
> **파일:** `apps/server/src/orders/order-status.service.ts`
> **배포:** 완료 (배포 직후 첫 폴링에서 14→3개 active로 자동 정리됨)

---

## 1. 발견 배경

wptest_hh 사용자의 BUY DUDE $1 주문이 어드민 트랜잭션에는 "오더북 등록 완료, 체결 대기 중(미체결)"로 표시되지만, Manifest 오더북 웹에서는 $1 매수 주문이 아예 존재하지 않는다는 제보를 받아 조사.

## 2. 조사 결과

### 2-1. DB vs 온체인 교차 검증

DUDE/USDT 마켓의 온체인 오더북을 SDK(`Market.findByMints`)로 직접 로드하여, DB의 `active` 상태 주문 14건과 비교.

| DB 상태 | 건수 | 온체인 실제 상태 |
|---|---|---|
| 정상 | 3건 | 오더북에 실제 존재 (seq=27, 28, 31) |
| 만료 | 2건 | `lastValidSlot`이 현재 슬롯보다 작음 (seq=64, 66) |
| 사라짐 | 5건 | cancel/fill/evict로 오더북에서 제거됨 |
| PlaceOrderLog 없음 | 4건 | tx에는 성공 로그가 있으나 Manifest 주문 로그 미기록 |

**결론: 14개 active 중 실제로 온체인에 존재하는 것은 3개뿐. 나머지 11개는 ghost active.**

### 2-2. 원인 분석

1. **`checkActiveOrders()`가 placement tx의 FillEvent만 확인** — 주문이 온체인에서 실제로 있는지는 검증하지 않음. FillEvent가 없으면 무조건 "미체결(active)"로 유지.

2. **이전 "사라짐=체결" 휴리스틱 제거의 후유증** — 과거에 "오더북에서 사라짐 = 체결" 로직이 가짜 체결을 양산하여 제거했으나, 대체 로직을 넣지 않아 cancel/evict된 주문도 영원히 active로 남게 됨.

3. **`manifest_sequence_number`이 대부분 null** — `extractOrderSequenceNumber()`가 tx 로그에서 PlaceOrderLog의 sequence number를 추출해야 하는데, 14건 중 10건이 null이었음 (DB에 저장되지 않음).

4. **가격 스케일 불일치** — 온체인 `quoteAtomsPerBaseAtom`은 1e12 스케일로 저장되고 DB 가격은 1e6 스케일이라, 가격 비교로 주문 매칭하면 절대 안 됨. 반드시 `manifest_sequence_number`로 매칭해야 함.

### 2-3. wptest_hh $1 BUY 구체 원인

- tx 분석: PlaceOrderLog 존재, `lastValidSlot=0`(NO_EXPIRATION), FillEvent 없음, tx 성공
- 지갑의 Manifest seat 확인: `quoteBalance=0` — USDT 잔고 없음
- 추정: BUY 주문에 필요한 USDT quote deposit이 없어 주문이 즉시 evict되었거나, Manifest HTTP API가 내부적으로 실패 처리

### 2-4. 7월 30일 4건 PlaceOrderLog 없음

tx에는 `Program MNFSTqt... success` 로그가 있으나, `PlaceOrderLog` discriminator(8바이트)를 가진 "Program data:" 로그가 전혀 없음. Manifest HTTP API(`manifest-orders.fly.dev/v1/orders`)가 주문 생성에 실패했을 가능성 (서버는 API 응답만 보고 성공으로 처리했을 수 있음).

## 3. 수정 내용

### 3-1. `checkActiveOrders()` — 온체인 오더북 대조 추가

기존 로직: placement tx의 FillEvent만 확인 → 없으면 무조건 active 유지

새 로직:
```
1. active 주문을 token_id별로 그룹화
2. 각 토큰의 Manifest 마켓을 한 번만 로드 (RPC 호출 최소화)
3. 마켓의 openOrders에서 sequenceNumber → Map 구축
4. 각 주문의 manifest_sequence_number로 매칭:
   a. 온체인에 없음 + FillEvent 있음 → filled
   b. 온체인에 없음 + FillEvent 없음 → cancelled
   c. 온체인에 있음 + lastValidSlot 만료 → expired
   d. 온체인에 있음 + 정상 → active 유지
   e. PlaceOrderLog 없음 → cancelled
   f. tx_signature 없음 + 5분 경과 → failed
```

### 3-2. `extractOrderSequenceNumber()` 개선

- 반환 타입 변경: `number | null` → `{ seq: number | null; lastValidSlot: number | null }`
- DB에 `manifest_sequence_number`가 없으면 자동 저장 (기존은 `checkSubmittedOrders`에서만 저장)
- PlaceOrderLog의 `lastValidSlot`도 함께 추출하여 반환

### 3-3. `reconcilePastOrders()` 확장

기존: `expired/failed` 주문 중 FillEvent가 있는 것만 → `filled` 복구

확장: `active` 주문도 대상에 포함. 온체인 오더북 대조로 stale 주문을 `cancelled`/`expired`로 보정. 어드민 `/orders/reconcile` API 호출 시 모든 잘못된 상태를 한 번에 정리 가능.

### 3-4. 신규 헬퍼 메서드

| 메서드 | 설명 |
|---|---|
| `loadMarketCache(tokenId)` | 토큰의 mint_address로 Manifest 마켓 로드 → `sequenceNumber → ChainOrderInfo` Map 반환 |
| `getCurrentSlot()` | RPC `getSlot` 호출로 현재 Solana 슬롯 반환 (만료 판정용) |

### 3-5. 신규 인터페이스

```typescript
interface ChainOrderInfo {
  sequenceNumber: string;
  lastValidSlot: number;
  trader: string;
}

interface MarketCache {
  ordersBySeq: Map<string, ChainOrderInfo>;
}
```

## 4. 배포 후 결과

```
[OrderStatusService] [active] order c01b74dc... — PlaceOrderLog 없음, cancelled 처리
[OrderStatusService] [active] order 40112f00... — PlaceOrderLog 없음, cancelled 처리
[OrderStatusService] [active] order a89a0c48... — PlaceOrderLog 없음, cancelled 처리
[OrderStatusService] [active] order 8462b212... — PlaceOrderLog 없음, cancelled 처리
[OrderStatusService] [active] order 02fdcab0... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order 633c303f... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order bfddac16... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order 5b008bcc... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order ff2eca00... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order d044d82c... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] order 8e8f9f94... CANCELLED (vanished from book, no FillEvent)
[OrderStatusService] [active] check result: 0 filled, 11 cancelled, 0 expired, 0 failed, 3 pending
```

**14개 active → 3개 active + 11개 cancelled (첫 폴링에서 자동 정리 완료)**

## 5. Manifest 관련 기술 참고

### SDK 상수
```typescript
NO_EXPIRATION_LAST_VALID_SLOT = 0   // 만료 없음
```

### PlaceOrderLog 구조 (SDK 역직렬화)
| 필드 | 타입 | 크기 |
|---|---|---|
| market | PublicKey | 32B |
| trader | PublicKey | 32B |
| price | QuoteAtomsPerBaseAtom (u128) | 16B |
| baseAtoms | BaseAtoms (u64) | 8B |
| orderSequenceNumber | u64 | 8B |
| orderIndex | u32 | 4B |
| lastValidSlot | u32 | 4B |
| orderType | Enum | 1B |
| isBid | bool | 1B |
| padding | u8[6] | 6B |

### Discriminant (상수 하드코딩)
```
FillLog:      3ae6f2034b7104a9
PlaceOrderLog: 9d76f7d52f13a478
```

### 주문 만료 판정 로직 (SDK `market.js` line 490-491)
```javascript
bid.lastValidSlot == NO_EXPIRATION_LAST_VALID_SLOT ||
Number(bid.lastValidSlot) > currentSlot
```

### Manifest HTTP API
- URL: `https://manifest-orders.fly.dev/v1/orders`
- limit 주문: `orderType: 'limit'`, `expirySlots` 미전송
- market 주문: `orderType: 'timeInForce'`, `expirySlots: 150` (~60초)
- ⚠️ limit에 `expirySlots`을 명시하지 않으면 API가 기본값을 부여할 가능성 있음 (문서화 안 됨)

## 6. 주의사항

- **체결 판단은 여전히 FillEvent로만** — "사라짐 = cancelled"이지 "사라짐 = filled"가 아님. 이전에 가짜 체결을 양산했던教训.
- 마켓 로드에 RPC 호출이 추가되지만, **token별로 한 번만 로드**하여 중복 방지 (현재 DUDE 1개 토큰만 거래 중이라 사실상 1회)
- 10초 폴링 주기에 마켓 로드 1회 + `getSlot` 1회 추가. Helius RPC 한도 내에서 충분히 여유 있음.
