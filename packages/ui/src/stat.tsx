import * as React from 'react';
import { cn } from './cn.js';
import { Card, CardContent } from './card.js';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  delta?: { value: string; positive?: boolean };
  icon?: React.ReactNode;
  className?: string;
}

export function Stat({ label, value, delta, icon, className }: StatProps) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {delta ? (
            <p
              className={cn(
                'mt-1 text-xs font-medium',
                delta.positive ? 'text-green-600' : 'text-red-600',
              )}
            >
              {delta.value}
            </p>
          ) : null}
        </div>
        {icon ? <div className="text-brand-500">{icon}</div> : null}
      </CardContent>
    </Card>
  );
}
