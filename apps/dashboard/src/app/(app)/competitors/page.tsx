import { getTenant } from '@/lib/tenant';
import { allRetailers } from '@/lib/retailers';
import { NoOrg } from '@/components/empty-state';
import { CompetitorsSection } from './competitors-section';
import { getOnboardingStatuses } from './actions';
import { isDevCrawlNowEnabled } from '@/lib/dev-flags';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;

  const [retailers, onboarding] = await Promise.all([allRetailers(), getOnboardingStatuses()]);
  const tracked = new Set(tenant.competitorRetailerIds);

  const options = retailers.map((r) => ({
    id: r.id,
    key: r.key,
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
      <CompetitorsSection
        retailers={options}
        ownRetailerId={tenant.org.ownRetailerId}
        onboarding={onboarding}
        devCrawlNowEnabled={isDevCrawlNowEnabled()}
      />
    </div>
  );
}
