import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@retailer/ui';
import { keywordGaps } from '@retailer/analytics';
import { getTenant } from '@/lib/tenant';
import { retailerMap } from '@/lib/retailers';
import { NoOrg, NoCompetitors } from '@/components/empty-state';

export const dynamic = 'force-dynamic';

export default async function SeoPage() {
  const tenant = await getTenant();
  if (!tenant) return <NoOrg />;
  if (tenant.competitorRetailerIds.length === 0) return <NoCompetitors />;

  if (!tenant.org.ownRetailerId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">SEO keyword gaps</h1>
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--muted-foreground)]">
            Set your own storefront on the Competitors page to compare keyword coverage against
            competitors.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [gaps, retailers] = await Promise.all([
    keywordGaps(tenant.org.ownRetailerId, tenant.competitorRetailerIds),
    retailerMap(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">SEO keyword gaps</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Keywords your competitors rank for that you don&apos;t.
      </p>
      <Card>
        <CardContent className="pt-6">
          {gaps.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No keyword gaps found (or no SERP data collected yet).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Competitor</TableHead>
                  <TableHead>Their rank</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gaps.map((g) => (
                  <TableRow key={`${g.term}-${g.competitorRetailerId}`}>
                    <TableCell className="font-medium">{g.term}</TableCell>
                    <TableCell>
                      {retailers.get(g.competitorRetailerId)?.name ?? 'Unknown'}
                    </TableCell>
                    <TableCell>#{g.competitorRank}</TableCell>
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
