import type { NextConfig } from "next";

const BASE_PATH = process.env.BASE_PATH !== undefined ? process.env.BASE_PATH : '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: BASE_PATH || undefined,
  assetPrefix: BASE_PATH || undefined,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
