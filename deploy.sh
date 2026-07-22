#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# DEX MINER BOT — AWS EC2 배포 스크립트
# ═══════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  🔥 DEX MINER BOT — AWS 배포 스크립트${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""

# ─── 1. 필수 도구 확인 ───
echo -e "${YELLOW}[1/6] 필수 도구 확인 중...${NC}"

for cmd in docker docker-compose node git; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}❌ $cmd 가 설치되어 있지 않습니다.${NC}"
        exit 1
    fi
    echo "  ✅ $cmd"
done

# pnpm 확인
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}  ⚠️  pnpm 미설치 — 설치 중...${NC}"
    corepack enable
    corepack prepare pnpm@10.34.5 --activate
fi
echo "  ✅ pnpm"

# ─── 2. .env 확인 ───
echo ""
echo -e "${YELLOW}[2/6] 환경 변수 확인 중...${NC}"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${YELLOW}  ⚠️  .env 파일이 없어 .env.example에서 복사했습니다.${NC}"
        echo -e "${YELLOW}      반드시 .env 파일을 수정하여 실제 값을 입력하세요!${NC}"
        echo ""
        echo "  필수 항목:"
        echo "    TELEGRAM_BOT_TOKEN=your_token"
        echo "    SUPABASE_URL=https://xxx.supabase.co"
        echo "    SUPABASE_ANON_KEY=your_anon_key"
        echo "    SUPABASE_SERVICE_KEY=your_service_key"
        echo "    SOLANA_RPC_URL=https://your-rpc.com"
        echo "    ADMIN_SECRET=your_secret"
        echo "    MINI_APP_URL=https://your-domain.com"
        echo "    TELEGRAM_BOT_USERNAME=your_bot_username"
        echo ""
        read -p "  .env 파일을 편집한 후 Enter를 누르세요..."
    else
        echo -e "${RED}❌ .env.example 파일도 없습니다. 프로젝트 루트에 .env를 생성하세요.${NC}"
        exit 1
    fi
else
    echo "  ✅ .env 파일 존재"
fi

# MINI_APP_URL 기본값 (도메인이 없으면 EC2 IP 사용)
if ! grep -q "MINI_APP_URL=" .env || grep -q "MINI_APP_URL=$" .env; then
    EC2_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_EC2_IP")
    echo -e "${YELLOW}  ⚠️  MINI_APP_URL이 설정되지 않았습니다. 자동으로 설정합니다: http://${EC2_IP}${NC}"
    echo "MINI_APP_URL=http://${EC2_IP}" >> .env
fi

# ─── 3. Docker 이미지 빌드 ───
echo ""
echo -e "${YELLOW}[3/6] Docker 이미지 빌드 중... (시간이 걸릴 수 있습니다)${NC}"
docker compose build --no-cache

# ─── 4. 컨테이너 시작 ───
echo ""
echo -e "${YELLOW}[4/6] 컨테이너 시작 중...${NC}"
docker compose up -d

# ─── 5. 상태 확인 ───
echo ""
echo -e "${YELLOW}[5/6] 컨테이너 상태 확인...${NC}"
sleep 5
docker compose ps

# ─── 6. 헬스체크 ───
echo ""
echo -e "${YELLOW}[6/6] 서버 헬스체크...${NC}"

MAX_RETRIES=10
RETRY=0
until curl -sf http://localhost/health > /dev/null 2>&1 || [ $RETRY -eq $MAX_RETRIES ]; do
    RETRY=$((RETRY + 1))
    echo "  ⏳ 대기 중... ($RETRY/$MAX_RETRIES)"
    sleep 3
done

if [ $RETRY -lt $MAX_RETRIES ]; then
    echo -e "${GREEN}  ✅ 서버 정상 동작!${NC}"
else
    echo -e "${YELLOW}  ⚠️  헬스체크 타임아웃. 로그를 확인하세요:${NC}"
    echo "    docker compose logs server"
fi

# ─── 완료 ───
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 배포 완료!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  📱 미니앱:    http://\$(curl -sf ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "  🛠️  어드민:    http://\$(curl -sf ifconfig.me 2>/dev/null || echo 'YOUR_IP')/admin"
echo "  🔌 API:      http://\$(curl -sf ifconfig.me 2>/dev/null || echo 'YOUR_IP')/api"
echo ""
echo "  📋 유용한 명령어:"
echo "    docker compose logs -f          # 전체 로그"
echo "    docker compose logs -f server    # 서버 로그"
echo "    docker compose restart           # 재시작"
echo "    docker compose down              # 중지"
echo "    docker compose up -d --build     # 재빌드 & 재시작"
echo ""
echo -e "${YELLOW}  ⚠️  SSL(HTTPS) 설정이 필요하면 아래 명령어를 실행하세요:${NC}"
echo "    ./ssl-setup.sh your-domain.com"
echo ""