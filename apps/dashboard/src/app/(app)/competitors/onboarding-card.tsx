'use client';

import { Card, CardContent } from '@retailer/ui';
import type { OnboardingStatus } from './actions';

export function hostOf(input: string): string {
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withProto).host.replace(/^www\./i, '');
  } catch {
    return input;
  }
}

export function OnboardingCard({
  item,
  onDismiss,
  dismissing,
}: {
  item: OnboardingStatus;
  onDismiss?: (id: string) => void;
  dismissing?: boolean;
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
          {onDismiss ? (
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
          ) : null}
        </CardContent>
      </Card>
    );
  }

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
