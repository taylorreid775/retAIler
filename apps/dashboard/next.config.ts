import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next transpile them.
  transpilePackages: [
    '@retailer/ui',
    '@retailer/schema',
    '@retailer/db',
    '@retailer/core',
    '@retailer/analytics',
  ],
  // drizzle/postgres are server-only; keep them out of the client bundle.
  serverExternalPackages: ['postgres', 'drizzle-orm'],
};

export default nextConfig;
