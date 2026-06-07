'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent } from '@retailer/ui';
import {
  addCompetitor,
  removeCompetitor,
  setOwnRetailer,
  dismissOnboarding,
  triggerCrawlNow,
  type OnboardingStatus,
} from './actions';
import { OnboardingCard } from './onboarding-card';

export interface RetailerOption {
  id: string;
  key: string;
  name: string;
  domain: string;
  tracked: boolean;
}

export function CompetitorList({
  retailers,
  ownRetailerId,
  onboarding = [],
  devCrawlNowEnabled = false,
}: {
  retailers: RetailerOption[];
  ownRetailerId: string | null;
  onboarding?: OnboardingStatus[];
  devCrawlNowEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [crawlQueued, setCrawlQueued] = useState<string | null>(null);

  // Poll for status changes while any onboarding row is still in progress.
  const hasActive = onboarding.some((o) => o.status === 'queued' || o.status === 'discovering');
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [hasActive, router]);

  const toggle = (r: RetailerOption) =>
    startTransition(async () => {
      setError(null);
      const res = r.tracked ? await removeCompetitor(r.id) : await addCompetitor(r.id);
      if (res.error) setError(res.error);
    });

  const chooseOwn = (id: string) =>
    startTransition(async () => {
      await setOwnRetailer(id === ownRetailerId ? null : id);
    });

  const dismiss = (id: string) =>
    startTransition(async () => {
      await dismissOnboarding(id);
      router.refresh();
    });

  const crawlNow = (r: RetailerOption) =>
    startTransition(async () => {
      setError(null);
      setCrawlQueued(null);
      const res = await triggerCrawlNow(r.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setCrawlQueued(r.id);
      setTimeout(() => setCrawlQueued(null), 4000);
    });

  // Show pending/failed cards inline at the top. `ready` rows have already been
  // promoted into the tracked list, so we auto-dismiss them (handled by the
  // notifier/refresh) and don't render them here.
  const visibleOnboarding = onboarding.filter((o) => o.status !== 'ready');

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {visibleOnboarding.length ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Being added
            </span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          {visibleOnboarding.map((o) => (
            <OnboardingCard
              key={o.id}
              item={o}
              onDismiss={o.id.startsWith('optimistic-') ? undefined : dismiss}
              dismissing={pending}
            />
          ))}
        </div>
      ) : null}

      {retailers.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{r.domain}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {devCrawlNowEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => crawlNow(r)}
                  title="Dev only — queues an immediate crawl via Redis"
                >
                  {crawlQueued === r.id ? 'Queued ✓' : 'Crawl now'}
                </Button>
              ) : null}
              <Button
                variant={r.id === ownRetailerId ? 'default' : 'outline'}
                size="sm"
                disabled={pending}
                onClick={() => chooseOwn(r.id)}
              >
                {r.id === ownRetailerId ? 'Your store' : 'Set as mine'}
              </Button>
              <Button
                variant={r.tracked ? 'destructive' : 'default'}
                size="sm"
                disabled={pending}
                onClick={() => toggle(r)}
              >
                {r.tracked ? 'Untrack' : 'Track'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
