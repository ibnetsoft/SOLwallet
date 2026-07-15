/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@solwallet/config', '@solwallet/shared-types'],
};

module.exports = nextConfig;
