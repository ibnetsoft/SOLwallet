# 🔥 AoiWallet — AWS 배포 가이드

## 1. EC2 인스턴스 생성

### 권장 사양
| 항목 | 권장 |
|------|------|
| **OS** | Ubuntu 22.04 LTS |
| **인스턴스 타입** | t3.medium (2 vCPU, 4GB RAM) |
| **스토리지** | 20GB gp3 |
| **보안 그룹** | 인바운드 22(SSH), 80(HTTP), 443(HTTPS) 개방 |

### 인스턴스 생성 절차
1. AWS Console → EC2 → 인스턴스 시작
2. Ubuntu 22.04 LTS AMI 선택
3. t3.medium 선택 (빌드 시 메모리 필요)
4. 20GB gp3 스토리지
5. 보안 그룹 생성:
   - SSH (22) — 본인 IP만
   - HTTP (80) — 0.0.0.0/0
   - HTTPS (443) — 0.0.0.0/0
6. 키페어 생성 후 다운로드

---

## 2. EC2 초기 설정

```bash
# SSH 접속
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Docker Compose 설치 (v2)
sudo apt install docker-compose-plugin -y

# Git 설치
sudo apt install git -y

# Node.js 20 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm 설치
corepack enable
corepack prepare pnpm@10.34.5 --activate

# 재로그인 (docker 그룹 적용)
exit
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

---

## 3. 프로젝트 배포

```bash
# 프로젝트 클론
cd ~
git clone https://github.com/ibnetsoft/SOLwallet.git
cd SOLwallet

# 환경 변수 설정
cp .env.example .env
nano .env  # 실제 값 입력

# 배포 스크립트 실행
chmod +x deploy.sh
./deploy.sh
```

---

## 4. .env 필수 설정값

```env
# ─── 필수 (반드시 설정) ───
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_KEY=eyJhbGci...
SOLANA_RPC_URL=https://your-rpc.helius-rpc.com
ADMIN_SECRET=your_strong_secret_here
TELEGRAM_BOT_USERNAME=your_bot_username

# ─── 배포 URL (EC2 IP 또는 도메인) ───
MINI_APP_URL=https://your-domain.com
ADMIN_APP_URL=https://your-domain.com

# ─── 포트 (기본값) ───
SERVER_PORT=3000
NODE_ENV=production
```

---

## 5. Supabase 초기 설정

### DB 마이그레이션 실행
Supabase Dashboard → SQL Editor에서 아래 순서로 실행:

```sql
-- 1. 초기 스키마 (users, wallets, tokens, orders, referrals)
-- supabase/migrations/001_initial_schema.sql 내용 복사 후 실행

-- 2. 추천인 코드 컬럼 추가
-- supabase/migrations/002_add_referral_code.sql 내용 복사 후 실행

-- 3. 시드 데이터 (SOL, USDT 토큰)
-- supabase/seed.sql 내용 복사 후 실행
```

### Storage 버킷 생성
1. Supabase Dashboard → Storage
2. `token-logos` 버킷 생성
3. **Public** 설정으로 변경

---

## 6. SSL 설정 (도메인 연결 후 필수)

도메인을 EC2 와 연결한 뒤 HTTPS 를 적용하는 절차. `ssl-setup.sh` 가
사전 점검(DNS 전파, 80포트) → 인증서 발급(apex + www) → nginx HTTPS 적용 →
HTTP→HTTPS 리다이렉트, www→apex 리다이렉트까지 자동 처리한다.

### 6-1. 사전 조건

- [ ] GoDaddy(또는 구매처)에서 A 레코드 2개 설정 — apex(`@`)와 `www` 모두 EC2 퍼블릭 IP
- [ ] DNS 전파 완료 — https://dnschecker.org 에서 apex/www 모두 EC2 IP로 조회되는지 확인
- [ ] AWS 보안그룹 인바운드에 **443(HTTPS)** 추가 (0.0.0.0/0)
- [ ] 먼저 `./deploy.sh` 로 HTTP 배포가 정상 동작 중인 상태 (`http://<IP>/health` 응답)

### 6-2. SSL 스크립트 실행

```bash
chmod +x ssl-setup.sh
./ssl-setup.sh your-domain.com
```

스크립트가 수행하는 작업:
1. 사전 점검 — EC2 IP, DNS A 레코드 일치 여부, 80포트 응답 확인
2. certbot 디렉토리 생성
3. ACME 검증용 nginx 설정 적용 (HTTP 80, `/.well-known/acme-challenge/` 검증 통과 보장)
4. Let's Encrypt 실서비스용 인증서 발급 (apex + www, `--keep-until-expiring`)
5. `nginx-ssl-applied.conf` 생성 (443 HTTPS + HTTP→HTTPS 리다이렉트 + www→apex 301 리다이렉트)
6. `docker-compose.yml` nginx 볼륨 자동 전환 → nginx 재시작
7. HTTPS 응답 및 리다이렉트 검증

> ⚠️ **Let's Encrypt rate limit**: 실서비스 인증서는 도메인당 하루 5회까지만 발급 가능.
> 실패 시 로그를 확인하고 원인 해결 후 재시도. DNS 전파가 완료되지 않은 상태에서
> 반복 시도하면 rate limit 에 걸릴 수 있음.

### 6-3. `.env` URL https 로 변경 (필수)

```bash
nano .env
```

```env
MINI_APP_URL=https://your-domain.com
ADMIN_APP_URL=https://your-domain.com
NODE_ENV=production
```

변경 후 컨테이너 재시작:

```bash
docker compose up -d
```

### 6-4. 검증

```bash
# HTTPS 정상 응답
curl -I https://your-domain.com/health

# HTTP → HTTPS 리다이렉트 (301)
curl -I http://your-domain.com

# www → apex 리다이렉트 (301)
curl -I https://www.your-domain.com
```

브라우저에서 자물쇠 아이콘과 미니앱/어드민 페이지가 정상 로드되면 완료.

### 6-5. 인증서 자동 갱신

`docker-compose.yml` 의 `certbot` 서비스가 12시간마다 `certbot renew` 를 실행한다.
nginx 는 파일 경로로 인증서를 참조하므로 갱신 후 reload 가 필요하다:

```bash
# 수동 갱신 적용 (필요 시)
docker compose exec nginx nginx -s reload
```

```bash
# 수동 갱신 적용 (필요 시)
docker compose exec nginx nginx -s reload
```

---

## 7. Telegram 봇 설정

### BotFather 설정
1. Telegram에서 `@BotFather` 검색
2. `/newbot` → 봇 이름 입력
3. Bot Token 복사 → `.env`의 `TELEGRAM_BOT_TOKEN`에 입력

### Mini App 연결
1. BotFather에서 `/mybots` → 봇 선택
2. **Bot Settings** → **Menu Button** → URL 설정:
   ```
   https://your-domain.com
   ```
3. **Web App Mode**가 활성화되어야 함

### 환경 변수 확인
```env
TELEGRAM_BOT_USERNAME=your_bot_username  # @ 제외
MINI_APP_URL=https://your-domain.com
```

---

## 8. 유용한 명령어

```bash
# 로그 확인
docker compose logs -f              # 전체
docker compose logs -f server        # API 서버만
docker compose logs -f mini-app      # 미니앱만
docker compose logs -f nginx         # Nginx만

# 재시작
docker compose restart               # 전체 재시작
docker compose restart server        # 서버만 재시작

# 재빌드 & 재시작 (코드 변경 시)
docker compose up -d --build

# 전체 중지
docker compose down

# 컨테이너 접속 (디버깅)
docker compose exec server sh
```

---

## 9. 트러블슈팅

### 빌드 실패 (메모리 부족)
```bash
# t3.micro 인스턴스인 경우 스왑 추가
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 포트 충돌
```bash
# 80/443 포트 사용 중인 프로세스 확인
sudo lsof -i :80
sudo lsof -i :443
```

### 컨테이너 계속 재시작됨
```bash
# 로그로 원인 확인
docker compose logs server --tail 100
# 대부분 .env 설정 오류
```