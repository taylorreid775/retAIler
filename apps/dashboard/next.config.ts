import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next transpile them.
  transpilePackages: [
    '@retailer/ui',
    '@retailer/schema',
    '@retailer/db',
    '@retailer/core',
    '@retailer/analytics',
    '@retailer/crawler',
  ],
  // drizzle/postgres are server-only; keep them out of the client bundle.
  serverExternalPackages: ['postgres', 'drizzle-orm'],
  webpack: (config, { dev }) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
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
