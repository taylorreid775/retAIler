'use client';

import { useMemo, useState } from 'react';
import { AddStoreForm } from './add-store-form';
import { CompetitorList, type RetailerOption } from './competitor-list';
import type { OnboardingStatus } from './actions';

export function CompetitorsSection({
  retailers,
  ownRetailerId,
  onboarding,
}: {
  retailers: RetailerOption[];
  ownRetailerId: string | null;
  onboarding: OnboardingStatus[];
}) {
  const [optimistic, setOptimistic] = useState<OnboardingStatus[]>([]);

  const mergedOnboarding = useMemo(() => {
    const byUrl = new Map<string, OnboardingStatus>();
    for (const row of onboarding) {
      byUrl.set(row.inputUrl.toLowerCase(), row);
    }
    for (const row of optimistic) {
      const key = row.inputUrl.toLowerCase();
      if (!byUrl.has(key)) byUrl.set(key, row);
    }
    return [...byUrl.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [onboarding, optimistic]);

  return (
    <>
      <AddStoreForm
        onOptimisticStart={(inputUrl) => {
          setOptimistic([
            {
              id: `optimistic-${inputUrl}`,
              inputUrl,
              status: 'discovering',
              error: null,
              updatedAt: new Date().toISOString(),
            },
          ]);
        }}
        onComplete={() => setOptimistic([])}
      />
      <CompetitorList
        retailers={retailers}
        ownRetailerId={ownRetailerId}
        onboarding={mergedOnboarding}
      />
    </>
  );
}
