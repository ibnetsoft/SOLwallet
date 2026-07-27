const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@solana/web3.js', 'bip39', 'tweetnacl', 'bs58', '@solwallet/config', '@solwallet/shared-types'],
};

module.exports = withPWA(nextConfig);
