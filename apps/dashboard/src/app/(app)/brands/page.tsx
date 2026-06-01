import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@retailer/ui';
import { brandGrowth } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { NoOrg, NoCompetitors } from '@/components/empty-state';

export const dynamic = 'force-dynamic';

export default async function BrandsPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  const rows = await brandGrowth(tenant.competitorRetailerIds, 30);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Brand trends (30 days)</h1>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No brand data yet — crawl some competitors first.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>New products</TableHead>
                  <TableHead>Total tracked</TableHead>
                  <TableHead>Growth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.brandId}>
                    <TableCell className="font-medium">{b.brandName}</TableCell>
                    <TableCell>{b.newProducts}</TableCell>
                    <TableCell>{b.totalProducts}</TableCell>
                    <TableCell>
                      <Badge variant={b.growthPct >= 10 ? 'success' : 'muted'}>
                        +{b.growthPct}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
