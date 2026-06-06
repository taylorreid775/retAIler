import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@retailer/ui', '@retailer/schema', '@retailer/db', '@retailer/core'],
  serverExternalPackages: ['postgres', 'drizzle-orm'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      };
    }
    return config;
  },
};

export default nextConfig;
