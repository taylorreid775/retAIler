import { Card, CardContent } from '@retailer/ui';
import { recentSignals } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { NoOrg, NoCompetitors } from '@/components/empty-state';
import { SignalFeed } from '@/components/signal-feed';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  const rows = await recentSignals(tenant.competitorRetailerIds, {
    types: ['low_stock', 'out_of_stock', 'back_in_stock'],
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Inventory alerts</h1>
      <Card>
        <CardContent className="pt-6">
          <SignalFeed rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
