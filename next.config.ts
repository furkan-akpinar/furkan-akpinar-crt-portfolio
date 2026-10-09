import type { NextConfig } from "next";
import path from 'node:path';
import { createAssetRoots } from './scripts/release-assets.ts';

const assetRoots = process.env.NODE_ENV === 'production'
  ? createAssetRoots(path.join(process.cwd(), 'public'))
  : {};

const nextConfig: NextConfig = {
  output: 'export',
  turbopack: { root: process.cwd() },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  env: { NEXT_PUBLIC_ASSET_ROOTS: JSON.stringify(assetRoots) },
};

export default nextConfig;
