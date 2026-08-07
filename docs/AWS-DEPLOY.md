# AWS EC2 배포 가이드

> **대상**: 이 프로젝트를 처음 배포하는 AI 또는 개발자
> **인프라**: AWS EC2 + Docker Compose + Nginx + Let's Encrypt
> **예상 소요 시간**: 30~60분 (EC2 프로비저닝 제외)

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [사전 요구사항](#2-사전-요구사항)
3. [EC2 인스턴스 생성](#3-ec2-인스턴스-생성)
4. [서버 초기 설정](#4-서버-초기-설정)
5. [소스 코드 배포](#5-소스-코드-배포)
6. [환경 변수 설정](#6-환경-변수-설정)
7. [첫 배포 (HTTP)](#7-첫-배포-http)
8. [SSL 인증서 설정 (HTTPS)](#8-ssl-인증서-설정-https)
9. [배포 업데이트](#9-배포-업데이트)
10. [트러블슈팅](#10-트러블슈팅)

---

## 1. 아키텍처 개요

```
                          ┌─────────────┐
                          │   인터넷     │
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │  AWS EC2    │
                          │  Ubuntu 24  │
                          └──────┬──────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
     ┌──────▼──────┐    ┌───────▼───────┐   ┌───────▼───────┐
     │   Nginx     │    │   Certbot     │   │  (SSH 접근)    │
     │  :80/:443   │    │  SSL 갱신     │   │  포트 22       │
     └──────┬──────┘    └───────────────┘   └───────────────┘
            │
     ┌──────┼──────────────────────────┐
     │      │                          │
┌────▼───┐ ┌▼──────────┐ ┌────────────▼──────┐
│mini-app│ │ admin     │ │ server (NestJS)   │
│:3001   │ │ :3002     │ │ :3000              │
│Next.js │ │ Next.js   │ │                    │
└────────┘ └───────────┘ └────────────────────┘
```

### 컨테이너 구성

| 서비스 | 이미지 | 포트 | 역할 |
|--------|--------|------|------|
| **server** | `Dockerfile.server` 빌드 | 3000 | NestJS API 서버 |
| **mini-app** | `Dockerfile.mini-app` 빌드 | 3001 | 사용자용 Next.js 프론트 (Telegram Mini App) |
| **admin** | `Dockerfile.admin` 빌드 | 3002 | 관리자 대시보드 Next.js |
| **nginx** | `nginx:alpine` | 80, 443 | 리버스 프록시 + SSL 종단 |
| **certbot** | `certbot/certbot` | — | Let's Encrypt 인증서 자동 갱신 (12h) |

### 볼륨 마운트

| 호스트 경로 | 컨테이너 경로 | 용도 |
|-------------|---------------|------|
| `./.env` | (env_file) | 환경 변수 |
| `./logs` | `/app/logs` | 서버 로그 영속화 (일별 로테이션) |
| `./nginx.conf` | `/etc/nginx/conf.d/default.conf` | Nginx 설정 (읽기 전용) |
| `./certbot/conf` | `/etc/letsencrypt` | SSL 인증서 |
| `./certbot/www` | `/var/www/certbot` | ACME 검증용 webroot |

---

## 2. 사전 요구사항

### 2-1. 준비물

| 항목 | 설명 |
|------|------|
| AWS 계정 | EC2, 보안그룹 설정 권한 |
| SSH 키 페어 | EC2 접속용 (`.pem` 파일) |
| 도메인 | SSL 인증서 발급용 (A 레코드를 EC2 IP로 설정) |
| Telegram Bot Token | `@BotFather`에서 발급 |
| Supabase 프로젝트 | URL, Anon Key, Service Key |
| Solana RPC 엔드포인트 | Helius, QuickNode 등 |
| Admin Secret | 관리자 로그인 비밀번호 |

### 2-2. 외부 서비스 가입

1. **Telegram Bot**: `@BotFather` → `/newbot` → 토큰 수령
2. **Supabase**: https://supabase.com → 프로젝트 생성 → Project URL, anon/public key, service_role key 확인
3. **Solana RPC**: https://helius.xyz 또는 https://quicknode.com → 엔드포인트 URL 수령

---

## 3. EC2 인스턴스 생성

### 3-1. 인스턴스 스펙 (최소 권장)

| 항목 | 값 |
|------|-----|
| OS | Ubuntu 24.04 LTS (amd64) |
| 인스턴스 타입 | `t3.medium` (2 vCPU, 4GB RAM) — 빌드 시 메모리 필요 |
| 스토리지 | 20GB gp3 이상 |
| SSH | 포트 22 개방 (본인 IP만 권장) |

### 3-2. 보안그룹 인바운드 규칙

| 포트 | 프로토콜 | 소스 | 용도 |
|------|----------|------|------|
| 22 | TCP | 본인 IP/32 | SSH 관리 |
| 80 | TCP | 0.0.0.0/0 | HTTP (ACME 검증 + 초기 배포) |
| 443 | TCP | 0.0.0.0/0 | HTTPS (SSL 적용 후) |

### 3-3. 탄력적 IP (권장)

EC2 인스턴스에 탄력적 IP를 할당하면 재시작 시 IP가 변경되지 않습니다.

---

## 4. 서버 초기 설정

EC2에 SSH로 접속하여 Docker를 설치합니다.

```bash
# SSH 접속 (본인 환경에 맞게 변경)
ssh -i ~/key.pem ubuntu@<EC2_PUBLIC_IP>

# 시스템 패키지 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치 (공식 방식)
curl -fsSL https://get.docker.com | sudo sh

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 docker 사용)
sudo usermod -aG docker $USER

# 로그아웃 후 재접속 (그룹 적용을 위해)
exit
ssh -i ~/key.pem ubuntu@<EC2_PUBLIC_IP>

# Docker 설치 확인
docker --version
docker compose version

# 필수 도구 설치
sudo apt install -y git curl
```

---

## 5. 소스 코드 배포

```bash
# 프로젝트 클론
cd ~
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet
```

> **비공개 레포지토리인 경우**: GitHub PAT(Personal Access Token)으로 인증하거나 SSH 키를 설정하세요.
>
> ```bash
> git clone https://<PAT>@github.com/ibnetsoft/SOLwallet.git
> ```

---

## 6. 환경 변수 설정

```bash
# 템플릿에서 .env 복사
cp .env.example .env

# .env 편집 (nano 또는 vim)
nano .env
```

### 필수 환경 변수

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ

# Supabase
SUPABASE_URL=https://abcdefghijklmnop.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...

# Solana RPC
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxxxx

# Admin
ADMIN_SECRET=your_strong_secret_password

# Wallet recovery 암호화 키 (32자 이상 랜덤 문자열)
MNEMONIC_ENCRYPTION_KEY=replace_with_at_least_32_random_characters

# 앱 URL (SSL 적용 전에는 http, 적용 후 https로 변경)
MINI_APP_URL=http://<EC2_PUBLIC_IP>
ADMIN_APP_URL=http://<EC2_PUBLIC_IP>

# Telegram Bot Username (@ 제외)
TELEGRAM_BOT_USERNAME=YourBotUsername

# Manifest DEX (기본값 유지)
MANIFEST_BASE_URL=https://manifest-orders.fly.dev/v1
```

> ⚠️ `.env` 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 이미 포함되어 있습니다.

---

## 7. 첫 배포 (HTTP)

### 방법 A: 배포 스크립트 사용 (권장)

```bash
chmod +x deploy.sh
./deploy.sh
```

스크립트가 다음을 자동으로 수행합니다:
1. Docker, pnpm 설치 확인
2. `.env` 파일 존재 확인
3. Docker 이미지 빌드 (`docker compose build --no-cache`)
4. 컨테이너 시작 (`docker compose up -d`)
5. 헬스체크 (`/health` 엔드포인트)

### 방법 B: 수동 배포

```bash
# 이미지 빌드 (최초는 5~10분 소요)
docker compose build

# 컨테이너 시작
docker compose up -d

# 상태 확인
docker compose ps

# 로그 확인
docker compose logs -f server
```

### 배포 확인

```bash
# 서버 헬스체크
curl http://localhost/health

# 미니앱 접속 (브라우저에서)
http://<EC2_PUBLIC_IP>

# 어드민 접속
http://<EC2_PUBLIC_IP>/admin
```

---

## 8. SSL 인증서 설정 (HTTPS)

### 전제 조건

- 도메인의 A 레코드가 EC2 공인 IP를 가리키고 있어야 함
- DNS 전파가 완료되어야 함 (https://dnschecker.org 에서 확인)
- `deploy.sh`로 HTTP 배포가 이미 완료되어 있어야 함

### SSL 설정 스크립트

```bash
chmod +x ssl-setup.sh
./ssl-setup.sh your-domain.com
```

스크립트 수행 절차:
1. DNS 전파 + 80포트 접근 확인
2. ACME 검증용 임시 nginx 설정 적용
3. Let's Encrypt 인증서 발급 (apex + www)
4. HTTPS용 nginx 설정 생성
5. nginx 재시작 + 동작 검증

### SSL 적용 후 .env 업데이트

```bash
nano .env
```

```env
# http → https 로 변경
MINI_APP_URL=https://your-domain.com
ADMIN_APP_URL=https://your-domain.com
```

```bash
# 컨테이너 재시작
docker compose up -d
```

### 인증서 자동 갱신

`docker-compose.yml`의 certbot 서비스가 12시간마다 갱신을 시도합니다. 별도 조치 불필요.

---

## 9. 배포 업데이트

코드 변경 후 서버에 반영하는 절차입니다.

### 전체 업데이트

```bash
cd ~/SOLwallet

# 최신 코드 가져오기
git pull origin main

# 이미지 재빌드 + 재시작
docker compose up -d --build
```

### 특정 서비스만 재빌드

```bash
# 서버만 재빌드
docker compose up -d --build server

# 프론트엔드만 재빌드
docker compose up -d --build mini-app admin
```

### 로컬 변경 사항이 있어 git pull이 실패할 때

```bash
# 변경사항 임시 보관 후 pull
git stash
git pull origin main

# stash 복원이 필요 없으면 그냥 진행
# 필요하면: git stash pop
```

### 빌드 실패 시

```bash
# 빌드 캐시 없이 재빌드
docker compose build --no-cache server
docker compose up -d server
```

---

## 10. 트러블슈팅

### 로그 확인

```bash
# 전체 컨테이너 로그
docker compose logs -f

# 특정 서비스 로그
docker compose logs -f server
docker compose logs -f mini-app
docker compose logs -f nginx

# 최근 100줄만
docker compose logs --tail 100 server

# 파일에 기록된 서버 로그 (JSON 형식, 30일 보관)
cat logs/server-$(date +%Y-%m-%d).log | python3 -m json.tool | tail -50

# 특정 userId의 로그 검색
grep '"userId":"target-user-id"' logs/server-*.log
```

### 컨테이너 상태

```bash
# 전체 상태
docker compose ps

# 재시작
docker compose restart server

# 전체 중지
docker compose down

# 전체 중지 + 볼륨 삭제 (⚠️ 로그도 삭제됨)
docker compose down -v
```

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| `docker compose build` 실패 — 메모리 부족 | `t3.micro` 등 메모리 부족 | 스왑 추가: `sudo fallocate -l 4G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` 또는 인스턴스 업그레이드 |
| `.env` 변경이 반영되지 않음 | 컨테이너 재시작 필요 | `docker compose up -d` |
| SSL 인증서 발급 실패 | DNS 전파 미완료 또는 80포트 차단 | dnschecker.org에서 DNS 확인, AWS 보안그룹 80포트 인바운드 확인 |
| `pnpm install`에서 native 모듈 에러 | `pnpm approve-builds` 필요 (bigint-buffer 등) | `.dockerignore` 확인 후 `--no-cache` 빌드 |
| 서버 빌드만 실패 (`nest build` 에러) | TypeScript 컴파일 에러 | `docker compose build --no-cache server` 후 로그 확인 |
| nginx 502 Bad Gateway | 백엔드 컨테이너 미작동 | `docker compose ps` 후 `docker compose logs server` 확인 |
| 컨테이너 재시작 후 로그 사라짐 | `docker logs`는 stdout만 표시 | `ls ~/SOLwallet/logs/`에서 파일 로그 확인 (볼륨 마운트로 영속) |

### 포트 충돌 확인

```bash
# EC2에서 어떤 포트가 열려있는지 확인
sudo ss -tlnp | grep -E ':80|:443|:3000|:3001|:3002'
```

### 디스크 사용량 확인

```bash
# Docker가 사용 중인 디스크
docker system df

# 불필요한 이미지/빌드 캐시 정리
docker system prune -af

# 로그 디렉토리 크기
du -sh ~/SOLwallet/logs/
```

---

## 부록: 프로젝트 구조

```
SOLwallet/
├── apps/
│   ├── server/          # NestJS API 서버 (포트 3000)
│   ├── mini-app/        # Next.js 사용자 프론트 (포트 3001)
│   └── admin/           # Next.js 관리자 대시보드 (포트 3002)
├── packages/
│   ├── config/          # 공유 설정 (@solwallet/config)
│   └── shared-types/    # 공유 타입 (@solwallet/shared-types)
├── logs/                # 서버 로그 (Docker 볼륨 마운트, 30일 보관)
├── certbot/
│   ├── conf/            # SSL 인증서
│   └── www/             # ACME webroot
├── Dockerfile.server
├── Dockerfile.mini-app
├── Dockerfile.admin
├── docker-compose.yml   # 컨테이너 오케스트레이션
├── nginx.conf           # HTTP용 nginx 설정
├── deploy.sh            # 배포 자동화 스크립트
├── ssl-setup.sh         # SSL 인증서 설정 스크립트
├── .env.example         # 환경 변수 템플릿
└── .env                 # 실제 환경 변수 (Git에 커밋 금지)
```

## 부록: 빌드 인자 (Build Args)

`docker-compose.yml`에서 프론트엔드 빌드 시 주입되는 환경 변수:

| 변수 | 설명 | 필수 |
|------|------|------|
| `NEXT_PUBLIC_API_URL` | API 베이스 경로 | Y (기본값: `/api`) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Telegram Bot 사용자명 | Y |
| `NEXT_PUBLIC_MINI_APP_URL` | 미니앱 접속 URL | Y |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC 엔드포인트 | Y |
| `SUPABASE_URL` | Supabase 프로젝트 URL | Y |

> `NEXT_PUBLIC_*` 변수는 **빌드 타임**에 평가됩니다. 변경 시 반드시 `--build` 플래그로 재빌드해야 합니다.
