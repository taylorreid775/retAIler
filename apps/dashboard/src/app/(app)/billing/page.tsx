import { Card, CardContent } from '@retailer/ui';
import { getTenant } from '@/lib/tenant';
import { isStripeConfigured } from '@/lib/stripe';
import { NoOrg } from '@/components/empty-state';
import { PlanCards } from './plan-cards';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          You are on the <strong>{tenant.org.plan}</strong> plan.
        </p>
      </div>

      {isStripeConfigured() ? (
        <PlanCards currentPlan={tenant.org.plan} />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--muted-foreground)]">
            Stripe is not configured. Set <code>STRIPE_SECRET_KEY</code> and the price IDs to enable
            checkout.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
