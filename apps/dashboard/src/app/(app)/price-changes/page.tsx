import { Card, CardContent } from '@retailer/ui';
import { recentSignals } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { NoOrg, NoCompetitors } from '@/components/empty-state';
import { SignalFeed } from '@/components/signal-feed';

export const dynamic = 'force-dynamic';

export default async function PriceChangesPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  const rows = await recentSignals(tenant.competitorRetailerIds, {
    types: ['price_drop', 'price_increase'],
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Price changes</h1>
      <Card>
        <CardContent className="pt-6">
          <SignalFeed rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
