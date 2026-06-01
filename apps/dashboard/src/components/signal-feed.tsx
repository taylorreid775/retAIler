import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@retailer/ui';
import type { RecentSignalRow } from '@retailer/analytics';

const severityVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  info: 'muted',
  notable: 'warning',
  critical: 'danger',
};

const typeLabel: Record<string, string> = {
  price_drop: 'Price drop',
  price_increase: 'Price increase',
  new_product: 'New product',
  back_in_stock: 'Back in stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  assortment_expansion: 'Assortment',
  seo_keyword_gap: 'SEO gap',
};

export function SignalFeed({ rows }: { rows: RecentSignalRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No activity in this period yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Signal</TableHead>
          <TableHead>Competitor</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="whitespace-nowrap text-xs font-medium">
              {typeLabel[s.type] ?? s.type}
            </TableCell>
            <TableCell>{s.title}</TableCell>
            <TableCell className="whitespace-nowrap">{s.retailerName}</TableCell>
            <TableCell>
              <Badge variant={severityVariant[s.severity] ?? 'muted'}>{s.severity}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
              {new Date(s.occurredAt).toLocaleDateString('en-CA', {
                month: 'short',
                day: 'numeric',
              })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
