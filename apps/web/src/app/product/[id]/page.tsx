import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@retailer/ui';
import { formatMoney } from '@retailer/schema';
import { getProduct, priceHistory } from '@/lib/catalog';
import { PriceHistoryChart } from '@/components/price-history-chart';

export const dynamic = 'force-dynamic';

const availabilityVariant: Record<string, 'success' | 'danger' | 'muted'> = {
  in_stock: 'success',
  out_of_stock: 'danger',
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id).catch(() => null);
  if (!product) notFound();

  const history = await priceHistory(id).catch(() => []);
  const cheapest = product.offers.find((o) => o.priceMinor != null);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="flex h-72 items-center justify-center overflow-hidden rounded-xl bg-[var(--muted)]">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.title} className="h-full object-contain" />
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]">No image</span>
          )}
        </div>
        <div className="space-y-3">
          {product.brand ? <p className="font-medium text-brand-600">{product.brand}</p> : null}
          <h1 className="text-2xl font-semibold">{product.title}</h1>
          {cheapest?.priceMinor != null ? (
            <p className="text-3xl font-bold">
              {formatMoney({
                amountMinor: cheapest.priceMinor,
                currency: cheapest.currency as 'CAD' | 'USD',
              })}
              <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
                best price at {cheapest.retailerName}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compare {product.offers.length} offers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Retailer</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.offers.map((o) => (
                <TableRow key={o.retailerProductId}>
                  <TableCell className="font-medium">{o.retailerName}</TableCell>
                  <TableCell>
                    {o.priceMinor != null
                      ? formatMoney({ amountMinor: o.priceMinor, currency: o.currency as 'CAD' | 'USD' })
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={availabilityVariant[o.availability] ?? 'muted'}>
                      {o.availability.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/go/${o.retailerProductId}`}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      View deal <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price history (90 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart points={history} />
        </CardContent>
      </Card>
    </div>
  );
}
