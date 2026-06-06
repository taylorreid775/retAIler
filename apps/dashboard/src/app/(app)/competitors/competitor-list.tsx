'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent } from '@retailer/ui';
import {
  addCompetitor,
  removeCompetitor,
  setOwnRetailer,
  dismissOnboarding,
  type OnboardingStatus,
} from './actions';

export interface RetailerOption {
  id: string;
  name: string;
  domain: string;
  tracked: boolean;
}

function hostOf(input: string): string {
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withProto).host.replace(/^www\./i, '');
  } catch {
    return input;
  }
}

export function CompetitorList({
  retailers,
  ownRetailerId,
  onboarding = [],
}: {
  retailers: RetailerOption[];
  ownRetailerId: string | null;
  onboarding?: OnboardingStatus[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
            <OnboardingCard key={o.id} item={o} onDismiss={dismiss} dismissing={pending} />
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
            <div className="flex items-center gap-2">
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

function OnboardingCard({
  item,
  onDismiss,
  dismissing,
}: {
  item: OnboardingStatus;
  onDismiss: (id: string) => void;
  dismissing: boolean;
}) {
  const host = hostOf(item.inputUrl);

  if (item.status === 'failed') {
    return (
      <Card className="border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium text-red-700 dark:text-red-400">{host}</p>
            <p className="mt-0.5 text-xs text-red-600/90 dark:text-red-400/80">
              {item.error || 'Could not add this store.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            disabled={dismissing}
            onClick={() => onDismiss(item.id)}
            className="shrink-0 rounded-md p-1 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/40"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </CardContent>
      </Card>
    );
  }

  // queued / discovering → animated "analyzing" card.
  return (
    <Card className="animate-pulse-subtle overflow-hidden">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-brand-500"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">{host}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Analyzing… protected sites can take a minute.
            </p>
          </div>
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {item.status === 'queued' ? 'Queued' : 'Discovering'}
        </span>
      </CardContent>
    </Card>
  );
}
