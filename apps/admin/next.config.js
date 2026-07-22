/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  basePath: '/admin',
  transpilePackages: ['@solwallet/config', '@solwallet/shared-types'],
};

module.exports = nextConfig;
