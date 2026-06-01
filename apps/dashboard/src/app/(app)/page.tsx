import { TrendingDown, PackagePlus, Boxes, Bell } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Stat } from '@retailer/ui';
import { recentSignals } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { NoOrg, NoCompetitors } from '@/components/empty-state';
import { SignalFeed } from '@/components/signal-feed';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  const ids = tenant.competitorRetailerIds;
  const [signals, priceDrops, newProducts, inventory] = await Promise.all([
    recentSignals(ids, { limit: 25 }),
    recentSignals(ids, { types: ['price_drop'], limit: 1000 }),
    recentSignals(ids, { types: ['new_product'], limit: 1000 }),
    recentSignals(ids, { types: ['low_stock', 'out_of_stock'], limit: 1000 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Tracking {ids.length} competitor{ids.length === 1 ? '' : 's'} on the {tenant.org.plan} plan.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Price drops" value={priceDrops.length} icon={<TrendingDown className="h-5 w-5" />} />
        <Stat label="New products" value={newProducts.length} icon={<PackagePlus className="h-5 w-5" />} />
        <Stat label="Inventory alerts" value={inventory.length} icon={<Boxes className="h-5 w-5" />} />
        <Stat label="Total signals" value={signals.length} icon={<Bell className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <SignalFeed rows={signals} />
        </CardContent>
      </Card>
    </div>
  );
}
