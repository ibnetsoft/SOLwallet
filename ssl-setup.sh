#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════
# SOLwallet — Let's Encrypt SSL 인증서 발급 + nginx HTTPS 적용
# ═══════════════════════════════════════════════════════════════
# 사용법: ./ssl-setup.sh your-domain.com
#
# 수행 작업:
#   1. 사전 점검 (DNS 전파, 80/443 포트 개방, EC2 공인 IP)
#   2. certbot 디렉토리 생성
#   3. ACME 검증용 nginx 임시 설정 (HTTP 80)
#   4. Let's Encrypt 인증서 발급 (apex + www, 실서비스용)
#   5. nginx-ssl-applied.conf 생성 (443 + HTTP→HTTPS 리다이렉트 + www→apex 리다이렉트)
#   6. docker-compose.yml nginx 볼륨 자동 전환
#   7. nginx 재시작 + 검증
# ═══════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}사용법: ./ssl-setup.sh your-domain.com${NC}"
    echo "  예: ./ssl-setup.sh solwallet.com"
    exit 1
fi

DOMAIN=$1
WWW_DOMAIN="www.${DOMAIN}"

echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  🔒 SSL 인증서 설정 (Let's Encrypt)${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  Apex 도메인:  ${BLUE}${DOMAIN}${NC}"
echo -e "  www 도메인:   ${BLUE}${WWW_DOMAIN}${NC}"
echo ""

# ─── 사전 확인: docker compose ───
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ docker 가 설치되어 있지 않습니다.${NC}"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# 1단계: 사전 점검 (DNS 전파 + 포트 개방)
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}[1/7] 사전 점검 중...${NC}"

# 1-1. EC2 공인 IP 확인
EC2_IP=$(curl -sf ifconfig.me 2>/dev/null || echo "")
if [ -z "$EC2_IP" ]; then
    echo -e "${RED}❌ EC2 공인 IP를 확인할 수 없습니다. 네트워크 연결을 확인하세요.${NC}"
    exit 1
fi
echo -e "  EC2 공인 IP: ${BLUE}${EC2_IP}${NC}"

# 1-2. DNS A 레코드 조회 (apex)
DNS_IP=$(dig +short "${DOMAIN}" A 2>/dev/null | head -n1 || echo "")
if [ -z "$DNS_IP" ]; then
    # dig 가 없으면 getent/host 시도
    DNS_IP=$(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -n1 || echo "")
fi

if [ -z "$DNS_IP" ]; then
    echo -e "${RED}❌ ${DOMAIN} 의 DNS A 레코드를 조회할 수 없습니다.${NC}"
    echo -e "   GoDaddy에서 A 레코드 설정 후 DNS 전파(최대 수시간)를 기다린 뒤 다시 실행하세요."
    echo -e "   확인: https://dnschecker.org/#A/${DOMAIN}"
    exit 1
fi
echo -e "  ${DOMAIN} → ${BLUE}${DNS_IP}${NC}"

if [ "$DNS_IP" != "$EC2_IP" ]; then
    echo -e "${RED}❌ DNS(${DNS_IP}) 가 EC2 공인 IP(${EC2_IP}) 와 일치하지 않습니다.${NC}"
    echo -e "   DNS 전파가 아직 완료되지 않았거나 GoDaddy A 레코드 값을 확인하세요."
    exit 1
fi

# 1-3. www DNS 확인 (경고만)
WWW_DNS_IP=$(dig +short "${WWW_DOMAIN}" A 2>/dev/null | head -n1 || echo "")
if [ -n "$WWW_DNS_IP" ] && [ "$WWW_DNS_IP" = "$EC2_IP" ]; then
    echo -e "  ${WWW_DOMAIN} → ${BLUE}${WWW_DNS_IP}${NC} (정상)"
elif [ -n "$WWW_DNS_IP" ]; then
    echo -e "${YELLOW}  ⚠️  ${WWW_DOMAIN} → ${WWW_DNS_IP} (EC2 IP와 불일치)${NC}"
    echo -e "${YELLOW}      www 인증서 발급이 실패할 수 있습니다. GoDaddy의 www A 레코드를 확인하세요.${NC}"
    read -p "  계속 진행하시겠습니까? (y/N) " CONTINUE
    [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ] && exit 1
else
    echo -e "${YELLOW}  ⚠️  ${WWW_DOMAIN} 의 A 레코드가 없습니다. www 인증서 발급이 생략됩니다.${NC}"
    read -p "  apex만 계속 진행하시겠습니까? (y/N) " CONTINUE
    [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ] && exit 1
    WWW_DOMAIN=""
fi

# 1-4. 80포트 확인 (certbot webroot 검증에 필수)
if ! curl -sf "http://${DOMAIN}" -o /dev/null --max-time 5 2>/dev/null; then
    echo -e "${YELLOW}  ⚠️  http://${DOMAIN} 접속 실패 — nginx 가 떠있지 않거나 80포트가 막혀있을 수 있습니다.${NC}"
    echo -e "${YELLOW}      먼저 ./deploy.sh 로 HTTP 배포를 완료하세요.${NC}"
    read -p "  그래도 계속 진행하시겠습니까? (y/N) " CONTINUE
    [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ] && exit 1
fi
echo -e "  ${GREEN}✅${NC} 80포트 정상 (certbot webroot 검증 가능)"

# 1-5. 443포트 수신 대기 중인지 확인 (이미 떠있으면 충돌 가능)
if ss -tlnp 2>/dev/null | grep -q ":443 " || netstat -tlnp 2>/dev/null | grep -q ":443 "; then
    echo -e "${YELLOW}  ⚠️  443포트가 이미 사용 중입니다. 기존 nginx가 있을 수 있습니다.${NC}"
fi

# AWS 보안그룹 443 개방 여부는 외부에서 점검해야 하므로 안만
echo -e "${YELLOW}  ℹ️  AWS 보안그룹에 443(HTTPS) 인바운드가 열려있는지 콘솔에서 확인하세요.${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════
# 2단계: certbot 디렉토리 생성
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}[2/7] certbot 디렉토리 준비...${NC}"
mkdir -p certbot/conf certbot/www
echo -e "  ${GREEN}✅${NC} certbot/conf, certbot/www 준비 완료"

# ═══════════════════════════════════════════════════════════════
# 3단계: ACME 검증용 임시 nginx 설정 (HTTP 80)
# certbot이 /.well-known/acme-challenge/ 로 검증 요청을 보내므로
# 이 경로를 mini-app 으로 프록시하지 않도록 별도 처리
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}[3/7] ACME 검증용 nginx 설정 적용...${NC}"

ACME_CONF="server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
"

echo "$ACME_CONF" > nginx-acme.conf

# docker-compose.yml 의 nginx 볼륨을 임시로 nginx-acme.conf 로 교체
patch_compose_volume() {
    local target_conf="$1"
    if grep -q "nginx-acme.conf\|nginx-ssl-applied.conf\|./nginx.conf" docker-compose.yml; then
        sed -i "s|./nginx.conf:/etc/nginx/conf.d/default.conf:ro|./${target_conf}:/etc/nginx/conf.d/default.conf:ro|" docker-compose.yml
        sed -i "s|./nginx-acme.conf:/etc/nginx/conf.d/default.conf:ro|./${target_conf}:/etc/nginx/conf.d/default.conf:ro|" docker-compose.yml
        sed -i "s|./nginx-ssl-applied.conf:/etc/nginx/conf.d/default.conf:ro|./${target_conf}:/etc/nginx/conf.d/default.conf:ro|" docker-compose.yml
    fi
}

patch_compose_volume "nginx-acme.conf"
echo -e "  ${GREEN}✅${NC} docker-compose.yml nginx 볼륨 → nginx-acme.conf"

docker compose up -d nginx
sleep 3
echo -e "  ${GREEN}✅${NC} ACME 검증용 nginx 시작"

# ═══════════════════════════════════════════════════════════════
# 4단계: Let's Encrypt 인증서 발급 (실서비스용 — staging 아님)
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[4/7] Let's Encrypt 인증서 발급 (실서비스용)...${NC}"
echo -e "${YELLOW}      ℹ️  실패 시 하루 5회 rate limit. DNS 전파를 확실히 확인하세요.${NC}"
echo ""

DOMAIN_ARGS="-d ${DOMAIN}"
[ -n "$WWW_DOMAIN" ] && DOMAIN_ARGS="${DOMAIN_ARGS} -d ${WWW_DOMAIN}"

docker run --rm \
    -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/certbot/www:/var/www/certbot" \
    certbot/certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email "admin@${DOMAIN}" \
    --agree-tos \
    --no-eff-email \
    --keep-until-expiring \
    $DOMAIN_ARGS

CERT_PATH="certbot/conf/live/${DOMAIN}"

# certbot 컨테이너는 root 로 인증서를 생성하므로 호스트 ubuntu 사용자가
# 디렉토리에 접근하지 못할 수 있다. sudo 로 가시성을 확보한다.
CERT_EXISTS=$(sudo test -f "${CERT_PATH}/fullchain.pem" && echo "yes" || echo "no")

if [ "$CERT_EXISTS" != "yes" ]; then
    echo -e "${RED}❌ 인증서 발급에 실패했습니다. 위 certbot 로그를 확인하세요.${NC}"
    echo -e "${YELLOW}   원인 의심:${NC}"
    echo -e "${YELLOW}   - DNS 전파 미완료 (dnschecker.org 에서 확인)${NC}"
    echo -e "${YELLOW}   - 80포트 차단 (AWS 보안그룹, EC2 방화벽)${NC}"
    echo -e "${YELLOW}   - www A 레코드 누락${NC}"
    echo -e "${YELLOW}   - 이미 같은 도메인으로 5회 이상 발급 시도 (rate limit)${NC}"
    # nginx 볼륨 원본 복구
    patch_compose_volume "nginx.conf"
    docker compose up -d nginx
    exit 1
fi
echo -e "  ${GREEN}✅${NC} 인증서 발급 완료: ${CERT_PATH}/fullchain.pem"

# ═══════════════════════════════════════════════════════════════
# 5단계: nginx-ssl-applied.conf 생성
#   - 443 HTTPS server (apex + www 모두)
#   - www → apex 301 리다이렉트 (사용자 정책)
#   - HTTP 80 → HTTPS 301 리다이렉트 (ACME 검증 location 유지)
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[5/7] nginx HTTPS 설정 생성...${NC}"

read -r -d '' SSL_CONF <<NGINX_EOF || true
# ─── HTTPS (apex + www 공통, www는 apex로 리다이렉트) ───
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${WWW_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    return 301 https://${DOMAIN}\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    client_max_body_size 10M;

    location /api/ {
        proxy_pass http://server:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://server:3000;
        proxy_set_header Host \$host;
    }

    location /admin {
        proxy_pass http://admin:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /_next/admin {
        proxy_pass http://admin:3002;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location /_next {
        proxy_pass http://mini-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://mini-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}

# ─── HTTP 80 → HTTPS 리다이렉트 (ACME 검증 location 유지) ───
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}
NGINX_EOF

echo "$SSL_CONF" > nginx-ssl-applied.conf
echo -e "  ${GREEN}✅${NC} nginx-ssl-applied.conf 생성"

# ═══════════════════════════════════════════════════════════════
# 6단계: docker-compose.yml nginx 볼륨 → nginx-ssl-applied.conf
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[6/7] docker-compose nginx 볼륨 전환...${NC}"
patch_compose_volume "nginx-ssl-applied.conf"
echo -e "  ${GREEN}✅${NC} docker-compose.yml nginx 볼륨 → nginx-ssl-applied.conf"

# ═══════════════════════════════════════════════════════════════
# 7단계: nginx 재시작 + 검증
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}[7/7] nginx 재시작 및 검증...${NC}"
docker compose up -d nginx
sleep 3

# nginx 설정 문법 검증
if docker compose exec -T nginx nginx -t 2>/dev/null; then
    echo -e "  ${GREEN}✅${NC} nginx 설정 문법 OK"
else
    echo -e "${RED}❌ nginx 설정 문법 오류. docker compose logs nginx 로 확인하세요.${NC}"
    exit 1
fi

# HTTPS 응답 검증
if curl -sf "https://${DOMAIN}/health" -o /dev/null --max-time 10 2>/dev/null; then
    echo -e "  ${GREEN}✅${NC} https://${DOMAIN}/health 정상 응답"
else
    echo -e "${YELLOW}  ⚠️  https://${DOMAIN}/health 응답 없음 — AWS 보안그룹 443 개방을 확인하세요.${NC}"
fi

# HTTP → HTTPS 리다이렉트 검증
REDIRECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}" --max-time 5 2>/dev/null || echo "000")
if [ "$REDIRECT_CODE" = "301" ] || [ "$REDIRECT_CODE" = "302" ]; then
    echo -e "  ${GREEN}✅${NC} HTTP → HTTPS 리다이렉트 정상 (${REDIRECT_CODE})"
else
    echo -e "${YELLOW}  ⚠️  HTTP 리다이렉트 응답 코드: ${REDIRECT_CODE}${NC}"
fi

# www → apex 리다이렉트 검증
if [ -n "$WWW_DOMAIN" ]; then
    WWW_REDIRECT=$(curl -s -o /dev/null -w "%{http_code}" "https://${WWW_DOMAIN}" --max-time 5 2>/dev/null || echo "000")
    if [ "$WWW_REDIRECT" = "301" ]; then
        echo -e "  ${GREEN}✅${NC} www → apex 리다이렉트 정상 (301)"
    else
        echo -e "${YELLOW}  ⚠️  www 응답 코드: ${WWW_REDIRECT}${NC}"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# 완료
# ═══════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ SSL 설정 완료!${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  🔒 미니앱:   ${BLUE}https://${DOMAIN}${NC}"
echo -e "  🛠️  어드민:   ${BLUE}https://${DOMAIN}/admin${NC}"
echo -e "  🔌 API:     ${BLUE}https://${DOMAIN}/api${NC}"
echo ""
echo -e "${YELLOW}  📝 다음 단계 (필수):${NC}"
echo -e "  .env 파일에서 URL을 https 로 변경한 뒤 컨테이너 재시작하세요:"
echo ""
echo -e "    ${BLUE}MINI_APP_URL=https://${DOMAIN}${NC}"
echo -e "    ${BLUE}ADMIN_APP_URL=https://${DOMAIN}${NC}"
echo ""
echo -e "  변경 후:"
echo "    docker compose up -d"
echo ""
echo -e "${YELLOW}  🔁 인증서 자동 갱신: docker-compose.yml 의 certbot 서비스가 12h마다 갱신합니다.${NC}"
echo ""
