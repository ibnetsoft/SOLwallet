const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // 배포할 때마다 오래된 서비스워커가 새 코드를 가려버리는 문제 방지 —
  // 새 SW가 설치되면 대기 없이 즉시 활성화되고, 열려있는 탭도 곧바로 새 SW로 전환됨.
  // (예전엔 사용자가 캐시/서비스워커를 수동으로 지워야만 새 배포가 반영됐음)
  reloadOnOnline: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@solana/web3.js', 'bip39', 'tweetnacl', 'bs58', '@solwallet/config', '@solwallet/shared-types'],
};

module.exports = withPWA(nextConfig);
