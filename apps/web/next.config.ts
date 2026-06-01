import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@retailer/ui', '@retailer/schema', '@retailer/db', '@retailer/core'],
  serverExternalPackages: ['postgres', 'drizzle-orm'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
