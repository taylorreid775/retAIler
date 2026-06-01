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
import { crawlHealth, dataFreshness, reviewBacklog } from '@retailer/analytics';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const [health, freshness, backlog] = await Promise.all([
    crawlHealth().catch(() => []),
    dataFreshness().catch(() => []),
    reviewBacklog().catch(() => ({ pending: 0 })),
  ]);

  const stale = freshness.filter((f) => (f.staleHours ?? Infinity) > 36);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">System status</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Retailers" value={health.length} />
        <Stat label="Stale (>36h)" value={stale.length} />
        <Stat label="Matches awaiting review" value={backlog.pending} />
      </div>

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
