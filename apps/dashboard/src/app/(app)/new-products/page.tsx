import { Card, CardContent } from '@retailer/ui';
import { recentSignals } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { NoOrg, NoCompetitors } from '@/components/empty-state';
import { SignalFeed } from '@/components/signal-feed';

export const dynamic = 'force-dynamic';

export default async function NewProductsPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  const rows = await recentSignals(tenant.competitorRetailerIds, {
    types: ['new_product', 'assortment_expansion'],
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New products</h1>
      <Card>
        <CardContent className="pt-6">
          <SignalFeed rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
