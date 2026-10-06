import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  turbopack: { root: process.cwd() },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
