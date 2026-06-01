import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3001';
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/go/'] },
    sitemap: `${base}/sitemap.xml`,
  };
}
