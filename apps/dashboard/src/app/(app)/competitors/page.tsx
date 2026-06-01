import { getTenant } from '@/lib/tenant';
import { allRetailers } from '@/lib/retailers';
import { NoOrg } from '@/components/empty-state';
import { CompetitorList } from './competitor-list';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;

  const retailers = await allRetailers();
  const tracked = new Set(tenant.competitorRetailerIds);

  const options = retailers.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    tracked: tracked.has(r.id),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Competitors</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Tracking {tenant.competitorRetailerIds.length} of {tenant.limits.maxCompetitors} allowed
          on the {tenant.org.plan} plan.
        </p>
      </div>
      <CompetitorList retailers={options} ownRetailerId={tenant.org.ownRetailerId} />
    </div>
  );
}
