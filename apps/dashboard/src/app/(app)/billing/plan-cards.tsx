'use client';

import { useState, useTransition } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from '@retailer/ui';
import { PLANS } from '@/lib/plans';
import { startCheckout, openPortal } from './actions';

export function PlanCards({ currentPlan }: { currentPlan: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const checkout = (planId: (typeof PLANS)[number]['id']) =>
    startTransition(async () => {
      setError(null);
      const res = await startCheckout(planId);
      if (res.error) setError(res.error);
      else if (res.url) window.location.href = res.url;
    });

  const portal = () =>
    startTransition(async () => {
      const res = await openPortal();
      if (res.error) setError(res.error);
      else if (res.url) window.location.href = res.url;
    });

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const active = p.id === currentPlan;
          return (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {active ? <Badge variant="success">Current</Badge> : null}
                </CardTitle>
                <p className="text-2xl font-bold">{p.priceLabel}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1 text-sm text-[var(--muted-foreground)]">
                  {p.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={active ? 'outline' : 'default'}
                  disabled={pending || active}
                  onClick={() => checkout(p.id)}
                >
                  {active ? 'Active' : 'Upgrade'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Button variant="outline" disabled={pending} onClick={portal}>
        Manage billing
      </Button>
    </div>
  );
}
