import type { NextConfig } from "next";
import path from 'node:path';
import { createAssetRoots } from './scripts/release-assets.ts';

const assetRoots = process.env.NODE_ENV === 'production'
  ? createAssetRoots(path.join(process.cwd(), 'public'))
  : {};

const nextConfig: NextConfig = {
  output: 'export',
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      // Fiber's unused default renderer otherwise retains a second rendering engine.
      // Subpaths such as three/webgpu, three/tsl and three/addons stay unchanged.
      three: { browser: './src/lib/three-browser.ts' },
    },
  },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  env: { NEXT_PUBLIC_ASSET_ROOTS: JSON.stringify(assetRoots) },
};

export default nextConfig;
