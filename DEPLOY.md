# AoiWallet — AWS 배포 가이드

이 문서는 EC2 단일 인스턴스 + Docker Compose + nginx + Let's Encrypt 기반의
배포 절차를 처음부터 끝까지 다룹니다. 현재 서비스 도메인은 `aoiwallet.com` 입니다.

> 실제 배포에 사용한 절차와 그 과정에서 발견한 함정(DNS 전파, certbot 권한,
> Elastic IP 등)을 모두 반영한 운영용 문서입니다.

---

## 현재 운영 환경 (실젯값)

| 항목 | 값 |
|------|-----|
| **EC2 퍼블릭 IP (Elastic IP)** | `13.113.246.134` |
| **키페어 파일** | `solwallet.pem` (저장소 루트; `*.pem` gitignore됨) |
| **SSH 사용자** | `ubuntu` |
| **리전** | ap-northeast-1 (도쿄) |
| **도메인** | `aoiwallet.com` (+ `www.aoiwallet.com`) |

### SSH 접속

```bash
# 저장소 루트에서 실행
ssh -i solwallet.pem ubuntu@13.113.246.134
```

> ⚠️ `.pem` 파일은 저장소에 커밋되지 않습니다(`*.pem` gitignore). 키 파일이
> 없는 환경에서는 AWS 콘솔에서 새 키페어를 발급받아야 합니다.
> Linux/macOS에서 권한 오류 시: `chmod 400 solwallet.pem`

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [EC2 인스턴스 생성](#2-ec2-인스턴스-생성)
3. [EC2 초기 설정 (Docker/Node)](#3-ec2-초기-설정-dockernode)
4. [프로젝트 배포 (HTTP)](#4-프로젝트-배포-http)
5. [.env 필수 설정값](#5-env-필수-설정값)
6. [Supabase 초기 설정](#6-supabase-초기-설정)
7. [도메인 연결 (GoDaddy DNS)](#7-도메인-연결-godaddy-dns)
8. [SSL 설정 (HTTPS, 자동화 스크립트)](#8-ssl-설정-https-자동화-스크립트)
9. [Telegram 봇 설정](#9-telegram-봇-설정)
10. [일상적 업데이트 배포 (코드 변경 시)](#10-일상적-업데이트-배포-코드-변경-시)
11. [로컬 개발 환경](#11-로컬-개발-환경)
12. [유용한 명령어](#12-유용한-명령어)
13. [트러블슈팅](#13-트러블슈팅)

---

## 1. 아키텍처 개요

```
인터넷 → GoDaddy DNS (A 레코드) → EC2 퍼블릭 IP
                                    │
                              ┌─────┴─────┐
                              │  nginx    │  (80 → 443 리다이렉트)
                              │  (443 SSL)│  Let's Encrypt 인증서
                              └─────┬─────┘
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
              │  server   │   │ mini-app  │   │  admin    │
              │ NestJS    │   │ Next.js   │   │ Next.js   │
              │ :3000     │   │ :3001     │   │ :3002     │
              └───────────┘   └───────────┘   └───────────┘
                    │
              ┌─────┴─────┐
              │ Supabase  │  (외부 DB — RLS 비활성, service_role 사용)
              └───────────┘

라우팅:
  /          → mini-app  (사용자 지갑/거래)
  /api/      → server    (NestJS API)
  /admin     → admin     (관리자 대시보드, basePath=/admin)
  /health    → server    (헬스체크)
```

- **단일 EC2 인스턴스**에 5개 Docker 컨테이너 (server, mini-app, admin, nginx, certbot)
- nginx만 80/443을 호스트에 노출, 나머지는 내부 네트워크
- SSL은 AWS ACM이 아닌 **Let's Encrypt + certbot** 사용

---

## 2. EC2 인스턴스 생성

### 권장 사양

| 항목 | 권장 | 비고 |
|------|------|------|
| **OS** | Ubuntu 22.04 LTS | (24.04도 가능) |
| **인스턴스 타입** | t3.medium (2 vCPU, 4GB) | 빌드 시 메모리 필요; micro는 스왑 필수 |
| **스토리지** | 20GB gp3 | Docker 이미지 + 인증서 갱신 로그 |
| **보안 그룹** | 22 / 80 / 443 인바운드 | 아래 참조 |

### 생성 절차
1. AWS Console → EC2 → **인스턴스 시작**
2. Ubuntu 22.04 LTS AMI 선택
3. t3.medium 선택
4. 20GB gp3 스토리지
5. 보안 그룹 생성:
   - **SSH (22)** — 본인 IP만 (0.0.0.0/0 절대 금지)
   - **HTTP (80)** — 0.0.0.0/0
   - **HTTPS (443)** — 0.0.0.0/0
6. 키페어 생성 후 다운로드 (`.pem`)

### ⚠️ Elastic IP 할당 (필수)

인스턴스 생성 직후 **반드시 Elastic IP(고정 IP)를 할당**하세요.

```
EC2 → 탄력적 IP(Elastic IPs) → 탄력적 IP 주소 할당 → 생성된 인스턴스에 연결
```

**이유**: `deploy.sh`가 매번 `curl ifconfig.me`로 퍼블릭 IP를 추출해
`MINI_APP_URL`을 설정합니다. 일시적 퍼블릭 IP를 쓰면 EC2 재부팅 시 IP가 바뀌어
GoDaddy DNS와 `.env`가 모두 끊깁니다. Elastic IP로 고정해야 합니다.

---

## 3. EC2 초기 설정 (Docker/Node)

```bash
# SSH 접속 (your-key.pem 경로와 EC2 IP를 실제 값으로)
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Docker Compose v2 (플러그인)
sudo apt install docker-compose-plugin -y

# Git (보통 설치되어 있음)
sudo apt install git -y

# Node.js 20 (deploy.sh 의존)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
corepack enable
corepack prepare pnpm@10.34.5 --activate

# ⚠️ docker 그룹 적용을 위해 재로그인 필수
exit
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# 확인
docker --version && docker compose version && pnpm --version
```

---

## 4. 프로젝트 배포 (HTTP)

```bash
# 프로젝트 클론
cd ~
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet

# 환경 변수 설정 (.env.example → .env 복사 후 실제 값 입력)
cp .env.example .env
nano .env   # 5번 섹션 참조하여 값 채우기

# 배포 스크립트 실행 (도구 확인 → 빌드 → 컨테이너 시작 → 헬스체크)
chmod +x deploy.sh
./deploy.sh
```

배포 완료 후 HTTP로 접속 확인 (도메인 연결 전, IP로):

```bash
# 헬스체크
curl http://localhost/health

# 브라우저: http://YOUR_EC2_IP
# 어드민:  http://YOUR_EC2_IP/admin
```

> 이 시점에서는 HTTP(80)만 동작합니다. HTTPS는 7~8번 섹션에서 도메인 연결 후 설정합니다.

---

## 5. .env 필수 설정값

```env
# ─── 필수 ───
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_KEY=eyJhbGci...
SOLANA_RPC_URL=https://your-rpc.helius-rpc.com
ADMIN_SECRET=your_strong_secret_here
TELEGRAM_BOT_USERNAME=your_bot_username

# ─── 배포 URL ───
# 도메인 연결 전(HTTP): http://YOUR_EC2_IP
# 도메인+SSL 연결 후:   https://aoiwallet.com
MINI_APP_URL=https://aoiwallet.com
ADMIN_APP_URL=https://aoiwallet.com

# ─── 포트/환경 ───
SERVER_PORT=3000
NODE_ENV=production
```

> ⚠️ `DEV_LOGIN_SECRET` 은 dev-login(`/auth/dev`) 보호용. 운영 환경에서는
> 강력한 랜덤 값으로 설정하거나, dev-login 비활성화 권장.

---

## 6. Supabase 초기 설정

### DB 마이그레이션

Supabase Dashboard → **SQL Editor**에서 아래 순서로 실행 (`supabase/migrations/` 파일 내용 복사):

```sql
-- 1. 초기 스키마 (users, wallets, tokens, orders, referrals)
--    supabase/migrations/001_initial_schema.sql

-- 2. 추천인 코드 컬럼 / manifest 메타데이터
--    supabase/migrations/002_add_referral_code.sql
--    supabase/migrations/002_manifest_metadata.sql

-- 3. 추천인 트리 함수 / 범용 설정 테이블
--    supabase/migrations/003_referral_tree.sql
--    supabase/migrations/003_settings.sql

-- 4. 시드 데이터 (SOL, USDT 토큰)
--    supabase/seed.sql
```

### Storage 버킷 생성
1. Supabase Dashboard → **Storage**
2. `token-logos` 버킷 생성
3. **Public** 설정으로 변경 (토큰 로고 이미지 공개 접근용)

---

## 7. 도메인 연결 (GoDaddy DNS)

GoDaddy 등에서 구매한 도메인의 A 레코드를 EC2 Elastic IP로 연결합니다.

### 7-1. DNS 관리 페이지 진입

https://dcc.godaddy.com/manage/`aoiwallet.com`/dns

### 7-2. 기본 파킹 레코드 정리

도메인 구매 직후 GoDaddy가 넣어둔 파킹(parking) 레코드를 삭제합니다:

| Type | Name | 삭제 대상 값 |
|------|------|------|
| A | `@` | `1.43.x.x` (GoDaddy 포워딩 IP) 또는 `Park` |
| CNAME | `www` | 포워딩 URL |

> **도메인 포워딩(Domain Forwarding)** 이 켜져있으면 A 레코드보다 우선하므로
> 반드시 **Forwarding 설정을 비활성화**하세요.

### 7-3. A 레코드 추가 (apex + www)

**ADD RECORD**로 두 개 추가:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `EC2_ELASTIC_IP` (예: 13.113.246.134) | 600 |
| **A** | `www` | 동일한 EC2 IP | 600 |

> NS 레코드(Name Server)는 **그대로 두세요** (수정/삭제 금지).

### 7-4. DNS 전파 확인 (10분~수시간)

```bash
# EC2 터미널에서 두 도메인 모두 EC2 IP가 나와야 함
dig +short aoiwallet.com A
dig +short www.aoiwallet.com A
```

또는 https://dnschecker.org 에서 apex/www 모두 EC2 IP로 조회되는지 확인.
전파 완료 후 8번 SSL 설정으로 진행.

---

## 8. SSL 설정 (HTTPS, 자동화 스크립트)

`ssl-setup.sh` 가 DNS 전파 확인 → Let's Encrypt 인증서 발급(apex + www) →
nginx HTTPS 적용 → HTTP→HTTPS 리다이렉트, www→apex 리다이렉트까지 자동 처리.

### 8-1. 사전 조건 체크리스트

- [ ] GoDaddy A 레코드 2개(apex + www) → EC2 IP 설정 완료
- [ ] DNS 전파 완료 (`dig` 로 두 도메인 모두 EC2 IP 확인)
- [ ] AWS 보안그룹 인바운드 **443(HTTPS)** 추가 (0.0.0.0/0)
- [ ] `./deploy.sh` 로 HTTP 배포 정상 동작 중 (`curl http://localhost/health` 응답)

### 8-2. SSL 스크립트 실행

```bash
chmod +x ssl-setup.sh
./ssl-setup.sh aoiwallet.com
```

스크립트 자동 처리 작업:
1. 사전 점검 — EC2 IP, DNS A 레코드 일치 여부, 80포트 응답 확인
2. certbot 디렉토리 생성
3. ACME 검증용 nginx 설정 적용 (80, `/.well-known/acme-challenge/` 검증 통과 보장)
4. Let's Encrypt 실서비스용 인증서 발급 (apex + www, `--keep-until-expiring`)
5. `nginx-ssl-applied.conf` 생성 (443 HTTPS + HTTP→HTTPS 리다이렉트 + www→apex 301)
6. `docker-compose.yml` nginx 볼륨 자동 전환 → nginx 재시작
7. HTTPS 응답 및 리다이렉트 검증

> ⚠️ **Let's Encrypt rate limit**: 실서비스 인증서는 도메인당 하루 5회까지만 발급.
> DNS 전파가 완료되지 않은 상태에서 반복 시도하면 rate limit에 걸립니다.
> 사전 조건을 모두 확실히 체크한 뒤 한 번에 성공해야 합니다.

### 8-3. `.env` URL을 https로 변경 (필수)

```bash
nano .env
```

```env
MINI_APP_URL=https://aoiwallet.com
ADMIN_APP_URL=https://aoiwallet.com
NODE_ENV=production
```

변경 후:
```bash
docker compose up -d
```

### 8-4. 검증

```bash
# HTTPS 정상 응답 (200 OK 기대)
curl -I https://aoiwallet.com/health

# HTTP → HTTPS 리다이렉트 (301)
curl -I http://aoiwallet.com

# www → apex 리다이렉트 (301)
curl -I https://www.aoiwallet.com
```

브라우저에서 자물쇠 아이콘과 미니앱/어드민 페이지가 정상 로드되면 완료.

### 8-5. 인증서 자동 갱신

`docker-compose.yml` 의 `certbot` 서비스가 12시간마다 `certbot renew` 를 실행.
nginx는 파일 경로로 인증서를 참조하므로 갱신 후 reload 필요:

```bash
# 갱신 주기에 맞춰 수동 reload (필요 시)
docker compose exec nginx nginx -s reload
```

---

## 9. Telegram 봇 설정

### BotFather 설정
1. Telegram에서 `@BotFather` 검색
2. `/newbot` → 봇 이름 입력
3. Bot Token 복사 → `.env`의 `TELEGRAM_BOT_TOKEN`에 입력

### Mini App 연결
1. BotFather에서 `/mybots` → 봇 선택
2. **Bot Settings** → **Menu Button** → URL 설정: `https://aoiwallet.com`
3. **Web App Mode** 활성화

### 환경 변수
```env
TELEGRAM_BOT_USERNAME=your_bot_username  # @ 제외
MINI_APP_URL=https://aoiwallet.com
```

---

## 10. 일상적 업데이트 배포 (코드 변경 시)

코드를 수정하고 GitHub에 push한 뒤 EC2에 반영하는 가장 자주 쓰는 절차.

### 변경된 앱만 재빌드 (빠름)

```bash
cd ~/SOLwallet
git pull origin main

# mini-app만 변경된 경우
docker compose up -d --build mini-app

# admin만 변경된 경우
docker compose up -d --build admin

# server(NestJS)만 변경된 경우
docker compose up -d --build server

# 여러 개 변경 시
docker compose up -d --build admin mini-app
```

### 전체 재빌드

```bash
git pull origin main
docker compose up -d --build   # 모든 서비스 재빌드
```

### `.env` 변경 시

```bash
nano .env                       # 값 수정
docker compose up -d            # 환경변수 재주입 (빌드 불필요)
```

### 빌드 후 확인

```bash
docker compose ps                          # 컨테이너 상태
docker compose logs -f mini-app --tail 20  # 앱 로그
curl -I https://aoiwallet.com/health       # 응답 확인
```

> 브라우저에서 확인 시 **캐시 무효화**: 시크릿 모드 사용 또는
> 개발자도구(F12) → Application → Local Storage → Clear 후 새로고침.

---

## 11. 로컬 개발 환경

### 사전 요구
- Node.js 20 (24는 Next.js 14 빌드 이슈 가능 → 20 권장)
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10.34.5 --activate`)
- Docker (선택 — 로컬에서 컨테이너로 돌릴 때만)

### 설치 및 실행

```bash
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet

# 의존성 설치
pnpm install

# 환경변수
cp .env.example .env
nano .env   # 로컬용 값 (TELEGRAM, SUPABASE, RPC 등)

# 개발 서버 (터미널 3개 또는 동시 실행)
pnpm --filter server dev        # API :3000
pnpm --filter mini-app dev      # 미니앱 :3001
pnpm --filter admin dev         # 어드민 :3002
```

- 미니앱: http://localhost:3001
- 어드민: http://localhost:3002/admin (basePath 주의)
- API: http://localhost:3000/api

### 타입체크 / 빌드

```bash
# 특정 앱 타입체크
pnpm --filter mini-app exec tsc --noEmit
pnpm --filter admin exec tsc --noEmit

# 특정 앱 빌드
pnpm --filter mini-app build
```

---

## 12. 유용한 명령어

```bash
# ─── 로그 ───
docker compose logs -f                # 전체
docker compose logs -f server          # API 서버만
docker compose logs -f mini-app        # 미니앱만
docker compose logs -f nginx           # nginx만
docker compose logs server --tail 100  # 최근 100줄

# ─── 재시작 ───
docker compose restart                 # 전체
docker compose restart server          # 서버만

# ─── 재빌드 & 재시작 ───
docker compose up -d --build           # 전체 재빌드
docker compose up -d --build mini-app  # 특정 앱만

# ─── 중지/삭제 ───
docker compose down                    # 전체 중지
docker compose down -v                 # 볼륨까지 삭제 (주의)

# ─── 컨테이너 접속 (디버깅) ───
docker compose exec server sh
docker compose exec nginx sh

# ─── nginx ───
docker compose exec nginx nginx -t              # 설정 문법 검증
docker compose exec nginx nginx -s reload       # 갱신 적용
```

---

## 13. 트러블슈팅

### 빌드 실패 (메모리 부족)

t3.micro 등 저사양 인스턴스에서 발생. 스왑 추가:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 포트 충돌 (80/443 점유)

```bash
sudo lsof -i :80
sudo lsof -i :443
# 기존 프로세스 종료 후 docker compose up -d
```

### 컨테이너 계속 재시작됨

대부분 `.env` 설정 오류. 로그로 원인 확인:

```bash
docker compose logs server --tail 100
docker compose logs mini-app --tail 100
```

### SSL 인증서 발급 실패

`ssl-setup.sh` 가 "인증서 발급 실패"로 종료할 때 원인:

1. **DNS 전파 미완료** — `dig +short aoiwallet.com A` 가 EC2 IP와 다름.
   https://dnschecker.org 에서 확인 후 대기.
2. **443 포트 차단** — AWS 보안그룹에 443 인바운드(0.0.0.0/0) 추가.
3. **www A 레코드 누락** — GoDaddy에서 www A 레코드 확인.
4. **rate limit 도달** — 하루 5회 초과 시 다음 날 재시도.

> 인증서 디렉토리는 root 권한(700)으로 생성되므로 확인 시 `sudo` 사용:
> `sudo ls -la certbot/conf/live/aoiwallet.com/`

### certbot 검증(cert)이 성공했는데 스크립트가 실패로 오팅

certbot 로그에 `Successfully received certificate` 가 있으면 **인증서는 정상 발급된 것**.
스크립트의 파일 존재 검증이 권한 문제로 실패한 것이므로, 아래 백업 절차로 수동 적용:

```bash
# 인증서 존재 확인 (sudo 필수)
sudo ls certbot/conf/live/aoiwallet.com/

# nginx-ssl-applied.conf 수동 생성
cp nginx-ssl-applied.conf.example nginx-ssl-applied.conf
sed -i 's/__DOMAIN__/aoiwallet.com/g' nginx-ssl-applied.conf

# docker-compose 볼륨 전환
sed -i 's|./nginx.conf:/etc/nginx/conf.d/default.conf:ro|./nginx-ssl-applied.conf:/etc/nginx/conf.d/default.conf:ro|' docker-compose.yml

# nginx 재시작 + 검증
docker compose up -d nginx
docker compose exec nginx nginx -t
curl -I https://aoiwallet.com/health
```

### admin 접속 시 유저 화면으로 튕김

`basePath=/admin` 설정과 `window.location.*` 충돌. 코드에서 `/admin/login`,
`/admin/` 경로를 명시했는지 확인 (5개 파일 6곳). 상세는 `apps/admin/` 소스 참조.

### 지갑 "최대 3개 생성" 에러가 잘못 뜸

로컬(localStorage)과 서버(Supabase) 동기화 문제. `initialize()`가 서버와
동기화하도록 수정됨. 그래도 발생하면:
1. 브라우저 localStorage 클리어 (개발자도구 → Application → Local Storage → Clear)
2. dev-login 공유 사용자(telegram_uid=999999999)의 지갑 정리 필요 시:

```sql
DELETE FROM wallets
WHERE user_id IN (SELECT id FROM users WHERE telegram_uid = 999999999);
```

---

## 부록: 파일 구조 (배포 관련)

```
SOLwallet/
├── deploy.sh                    # HTTP 배포 스크립트 (최초 1회)
├── ssl-setup.sh                 # SSL 자동화 스크립트 (도메인 연결 후)
├── docker-compose.yml           # 5개 컨테이너 정의
├── nginx.conf                   # HTTP 전용 (초기)
├── nginx-ssl-applied.conf.example  # HTTPS 템플릿 (도메인 치환용)
├── .env / .env.example          # 환경변수
├── Dockerfile.server            # NestJS :3000
├── Dockerfile.mini-app          # Next.js :3001
├── Dockerfile.admin             # Next.js :3002 (basePath=/admin)
├── apps/
│   ├── server/                  # NestJS API
│   ├── mini-app/                # 사용자용 Next.js
│   └── admin/                   # 관리자용 Next.js
├── packages/config/             # 공유 설정 (MAX_WALLETS=3 등)
└── supabase/migrations/         # DB 스키마
```
