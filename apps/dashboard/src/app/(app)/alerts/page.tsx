import { Badge, Card, CardContent, CardHeader, CardTitle } from '@retailer/ui';
import { getTenant } from '@/lib/tenant';
import { alertEventsForOrg, alertRulesForOrg } from '@/lib/alerts';
import { NoOrg } from '@/components/empty-state';
import { AlertRuleForm } from './alert-rule-form';
import { MarkReadButton } from './mark-read-button';

export const dynamic = 'force-dynamic';

const severityVariant: Record<string, 'warning' | 'danger' | 'muted'> = {
  info: 'muted',
  notable: 'warning',
  critical: 'danger',
};

export default async function AlertsPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;

  const [events, rules] = await Promise.all([
    alertEventsForOrg(tenant.org.id),
    alertRulesForOrg(tenant.org.id),
  ]);
  const unread = events.filter((e) => !e.readAt).length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            Alerts {unread > 0 ? <Badge variant="danger">{unread} new</Badge> : null}
          </h1>
          {unread > 0 ? <MarkReadButton /> : null}
        </div>
        <Card>
          <CardContent className="space-y-2 pt-6">
            {events.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No alerts yet. Create a rule to start receiving them.
              </p>
            ) : (
              events.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-center justify-between rounded-md border border-[var(--border)] p-3 ${
                    e.readAt ? 'opacity-60' : ''
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{e.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{e.retailerName}</p>
                  </div>
                  <Badge variant={severityVariant[e.severity] ?? 'muted'}>{e.severity}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Alert rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AlertRuleForm />
            <div className="space-y-2">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="rounded-md border border-[var(--border)] p-3 text-xs"
                >
                  <p className="font-medium">
                    {r.signalTypes.length ? r.signalTypes.join(', ') : 'All signals'}
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    ≥ {r.minSeverity} · {r.channels.join(', ')} · {r.enabled ? 'on' : 'off'}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
