'use client';

import { useTransition } from 'react';
import { Button } from '@retailer/ui';
import { markAllRead } from './actions';

export function MarkReadButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => markAllRead())}
    >
      Mark all read
    </Button>
  );
}
