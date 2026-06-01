import Link from 'next/link';
import { Card, CardContent } from '@retailer/ui';

export function NoOrg() {
  return (
    <Card>
      <CardContent className="p-10 text-center">
        <h2 className="text-lg font-semibold">No organization selected</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Create or select an organization from the switcher above to start tracking competitors.
        </p>
      </CardContent>
    </Card>
  );
}

export function NoCompetitors() {
  return (
    <Card>
      <CardContent className="p-10 text-center">
        <h2 className="text-lg font-semibold">No competitors tracked yet</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Choose the retailers you want to monitor.
        </p>
        <Link
          href="/competitors"
          className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          Select competitors
        </Link>
      </CardContent>
    </Card>
  );
}
