# 🔥 DEX MINER BOT

> 솔라나 지정가 거래 전용 텔레그램 미니앱

## 프로젝트 소개

Manifest.trade API를 연동하여, 사용자가 본인의 안전한 로컬 지갑을 통해 어드민이 직접 등록해 둔 토큰들을 지정가 주문(Limit Order)으로 손쉽게 거래할 수 있는 초경량 텔레그램 미니앱입니다.

## 핵심 특징

- 🔒 **로컬 지갑 서명** — 개인키는 사용자 디바이스에만 저장, 서버 전송 없음
- 📊 **지정가 전용** — Limit Buy / Limit Sell만 지원 (AMM Swap 제외)
- 🛡️ **화이트리스트 토큰** — 어드민이 등록한 안전한 토큰만 거래 가능
- 📱 **텔레그램 미니앱** — Telegram WebApp 기반 모바일 최적화
- 💰 **수수료 1%** — 거래 수수료 비즈니스 로직 내장

## 기술 스택

| 영역 | 기술 |
|------|------|
| 미니앱 | Next.js + Tailwind CSS |
| 어드민 | Next.js |
| 백엔드 | NestJS |
| 데이터베이스 | Supabase (PostgreSQL) |
| DEX SDK | Manifest.trade SDK |
| 블록체인 | Solana (web3.js, spl-token) |

## 시작하기

자세한 개발 가이드는 [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)를 참조하세요.

```bash
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet
pnpm install
cp .env.example .env
# .env에 필요한 API 키들을 입력하세요
```

## 문서

- 📖 [개발 기획서 & 길라잡이](./DEVELOPMENT_GUIDE.md)

## 라이선스

Proprietary — All rights reserved.
