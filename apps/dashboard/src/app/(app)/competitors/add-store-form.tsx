'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@retailer/ui';
import {
  startAddStoreByUrl,
  processAddStoreByUrl,
  type AddStoreResult,
} from './actions';

export function AddStoreForm({
  onOptimisticStart,
  onComplete,
}: {
  onOptimisticStart?: (inputUrl: string) => void;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AddStoreResult | null>(null);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setResult(null);

    const normalized =
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    onOptimisticStart?.(normalized);

    startTransition(async () => {
      const start = await startAddStoreByUrl(trimmed);
      if (start.error || start.trackedExisting) {
        onComplete?.();
        setResult(start);
        router.refresh();
        return;
      }
      if (!start.onboardingId) {
        onComplete?.();
        setResult({ error: 'Failed to start store onboarding' });
        router.refresh();
        return;
      }

      // DB row exists — refresh so the persistent "Being added" card appears.
      setUrl('');
      router.refresh();

      const res = await processAddStoreByUrl(start.onboardingId);
      onComplete?.();
      setResult(res);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a store</CardTitle>
        <CardDescription>
          Paste a store&apos;s homepage URL. We&apos;ll locate its sitemap, robots.txt and
          llms.txt, confirm where its products live, and start crawling. If the store already
          exists, we&apos;ll just track it for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            inputMode="url"
            placeholder="https://store.example.com"
            value={url}
            disabled={pending}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
          />
          <Button onClick={submit} disabled={pending || !url.trim()}>
            {pending ? 'Adding…' : 'Add store'}
          </Button>
        </div>

        {result?.error ? <p className="text-sm text-red-600">{result.error}</p> : null}

        {result?.trackedExisting ? (
          <p className="text-sm text-green-600">
            That store is already on the platform — now tracked for your organization.
          </p>
        ) : null}

        {result?.pending ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Handed off to background analysis. Protected sites can take a minute — you can leave
            this page and we&apos;ll notify you when it&apos;s ready.
          </p>
        ) : null}

        {result?.discovery && !result.error && !result.pending ? (
          <DiscoverySummary discovery={result.discovery} created />
        ) : null}
      </CardContent>
    </Card>
  );
}

function DiscoverySummary({
  discovery,
  created,
}: {
  discovery: NonNullable<AddStoreResult['discovery']>;
  created: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] p-3 text-sm">
      {created ? (
        <p className="mb-2 font-medium text-green-600">
          Added {discovery.name} and queued a crawl. It runs once a crawler picks it up.
        </p>
      ) : (
        <p className="mb-2 font-medium">What we found</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[var(--muted-foreground)]">
        <dt>Domain</dt>
        <dd className="text-[var(--foreground)]">{discovery.domain}</dd>
        <dt>Sitemap</dt>
        <dd className="break-all text-[var(--foreground)]">
          {discovery.sitemapUrl ?? 'not found'}
          {discovery.sitemapUrls.length > 1
            ? ` (+${discovery.sitemapUrls.length - 1} more product sitemap${
                discovery.sitemapUrls.length - 1 === 1 ? '' : 's'
              })`
            : ''}
        </dd>
        <dt>Product pattern</dt>
        <dd className="text-[var(--foreground)]">{discovery.productUrlPattern ?? 'unknown'}</dd>
        <dt>llms.txt</dt>
        <dd className="break-all text-[var(--foreground)]">{discovery.llmsTxtUrl ?? 'not found'}</dd>
        <dt>Fetch strategy</dt>
        <dd className="text-[var(--foreground)]">{discovery.fetchStrategy}</dd>
        <dt>Confidence</dt>
        <dd className="text-[var(--foreground)]">{Math.round(discovery.confidence * 100)}%</dd>
      </dl>
      {discovery.sampleProductUrls.length ? (
        <div className="mt-2">
          <p className="text-[var(--muted-foreground)]">Sample products</p>
          <ul className="mt-1 space-y-0.5">
            {discovery.sampleProductUrls.map((u) => (
              <li key={u} className="break-all text-xs text-[var(--foreground)]">
                {u}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
