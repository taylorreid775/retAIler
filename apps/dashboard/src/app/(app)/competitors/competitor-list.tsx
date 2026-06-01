'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent } from '@retailer/ui';
import { addCompetitor, removeCompetitor, setOwnRetailer } from './actions';

export interface RetailerOption {
  id: string;
  name: string;
  domain: string;
  tracked: boolean;
}

export function CompetitorList({
  retailers,
  ownRetailerId,
}: {
  retailers: RetailerOption[];
  ownRetailerId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
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
