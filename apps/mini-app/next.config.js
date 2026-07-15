/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@solana/web3.js', 'bip39', 'tweetnacl', 'bs58'],
};

module.exports = nextConfig;
