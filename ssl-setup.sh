#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}사용법: ./ssl-setup.sh your-domain.com${NC}"
    exit 1
fi

DOMAIN=$1

echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  🔒 SSL 인증서 설정 (Let's Encrypt)${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  도메인: ${DOMAIN}"
echo ""

# ─── 1. nginx.conf에 SSL 추가 (기존 80포트 + 443 SSL) ───
SSL_CONF="server {
    listen 443 ssl http2;
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

    location /_next {
        proxy_pass http://mini-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        expires 365d;
        add_header Cache-Control \"public, immutable\";
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

server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
"

echo -e "${YELLOW}[1/4] SSL용 nginx 설정 생성...${NC}"
echo "$SSL_CONF" > nginx-ssl.conf

# ─── 2. certbot 디렉토리 생성 ───
mkdir -p certbot/conf certbot/www

# ─── 3. 임시 인증서 발급 (nginx 시작용) ───
echo -e "${YELLOW}[2/4] 임시 인증서 발급...${NC}"
docker run --rm \
    -v $(pwd)/certbot/conf:/etc/letsencrypt \
    -v $(pwd)/certbot/www:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email admin@${DOMAIN} \
    --agree-tos \
    --no-eff-email \
    -d ${DOMAIN} \
    --staging || true

# ─── 4. nginx 교체 & 재시작 ───
echo -e "${YELLOW}[3/4] nginx SSL 설정 적용...${NC}"
cp nginx-ssl.conf nginx-ssl-applied.conf

# docker-compose에 SSL nginx 마운트 추가 안내
echo -e "${YELLOW}[4/4] SSL nginx로 전환...${NC}"
echo ""
echo -e "${GREEN}  ✅ SSL 설정 완료!${NC}"
echo ""
echo "  docker-compose.yml의 nginx 섹션을 아래와 같이 수정하세요:"
echo ""
echo '  nginx:'
echo '    volumes:'
echo '      - ./nginx-ssl-applied.conf:/etc/nginx/conf.d/default.conf:ro'
echo '      - ./certbot/conf:/etc/letsencrypt:ro'
echo '      - ./certbot/www:/var/www/certbot:ro'
echo '    ports:'
echo '      - "443:443"'
echo '      - "80:80"'
echo ""
echo "  그런 다음 재시작:"
echo "    docker compose restart nginx"
echo ""
echo "  .env 파일에서도 URL을 https로 변경하세요:"
echo "    MINI_APP_URL=https://${DOMAIN}"
echo "    ADMIN_APP_URL=https://${DOMAIN}"
echo ""
