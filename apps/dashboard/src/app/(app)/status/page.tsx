import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@retailer/ui';
import { crawlHealth, dataFreshness, reviewBacklog, discoveryCostSummary, discoveryCostWeekly } from '@retailer/analytics';
import { db, schema, eq } from '@retailer/db';
import { isOpsUiEnabled } from '@/lib/ops-flags';
import { canAccessOpsUi } from '@/lib/ops-auth';
import { RecipeVersionsPanel } from './recipe-versions-panel';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const opsEnabled = isOpsUiEnabled() && (await canAccessOpsUi());
  const [health, freshness, backlog, costSummary, costWeekly, retailerHealth] = await Promise.all([
    crawlHealth().catch(() => []),
    dataFreshness().catch(() => []),
    reviewBacklog().catch(() => ({ pending: 0 })),
    opsEnabled ? discoveryCostSummary().catch(() => null) : Promise.resolve(null),
    opsEnabled ? discoveryCostWeekly().catch(() => []) : Promise.resolve([]),
    opsEnabled
      ? db
          .select({
            id: schema.retailers.id,
            name: schema.retailers.name,
            crawlHealthScore: schema.retailers.crawlHealthScore,
          })
          .from(schema.retailers)
          .where(eq(schema.retailers.enabled, true))
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const stale = freshness.filter((f) => (f.staleHours ?? Infinity) > 36);
  const healthScoreById = new Map(
    retailerHealth.map((r) => [r.id, r.crawlHealthScore ?? null]),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">System status</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Retailers" value={health.length} />
        <Stat label="Stale (>36h)" value={stale.length} />
        <Stat label="Matches awaiting review" value={backlog.pending} />
      </div>

      {opsEnabled && costSummary ? (
        <Card>
          <CardHeader>
            <CardTitle>Discovery cost (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Total cost" value={`$${costSummary.totalCostUsd30d.toFixed(4)}`} />
              <Stat label="Runs" value={costSummary.runCount30d} />
              <Stat label="Tokens" value={costSummary.totalTokens30d} />
              <Stat label="Over $0.10" value={costSummary.overBudgetCount30d} />
            </div>
            {costWeekly.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Runs</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costWeekly.map((w) => (
                    <TableRow key={w.weekStart}>
                      <TableCell>{w.weekStart}</TableCell>
                      <TableCell>{w.runCount}</TableCell>
                      <TableCell>{w.totalTokens}</TableCell>
                      <TableCell>${w.totalCostUsd.toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                No completed discovery runs in the last 8 weeks.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Crawl health</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Retailer</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Freshness</TableHead>
                {opsEnabled ? <TableHead>Ops</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.map((h) => {
                const fresh = freshness.find((f) => f.retailerId === h.retailerId);
                return (
                  <TableRow key={h.retailerId}>
                    <TableCell className="font-medium">{h.retailerName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          h.lastStatus === 'completed'
                            ? 'success'
                            : h.lastStatus === 'failed'
                              ? 'danger'
                              : 'muted'
                        }
                      >
                        {h.lastStatus ?? 'never'}
                      </Badge>
                    </TableCell>
                    <TableCell>{h.lastProductsExtracted ?? 0}</TableCell>
                    <TableCell>{h.lastErrorCount ?? 0}</TableCell>
                    <TableCell>{h.activeProducts}</TableCell>
                    <TableCell>
                      {fresh?.staleHours != null ? (
                        <Badge variant={fresh.staleHours > 36 ? 'warning' : 'success'}>
                          {fresh.staleHours}h ago
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    {opsEnabled ? (
                      <TableCell>
                        <RecipeVersionsPanel
                          retailerId={h.retailerId}
                          retailerName={h.retailerName}
                          crawlHealthScore={healthScoreById.get(h.retailerId) ?? null}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
