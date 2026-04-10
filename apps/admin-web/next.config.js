/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['undici', 'firebase', '@firebase/app', '@firebase/auth', '@firebase/app-check-interop-types'],
  },
};
module.exports = config;
