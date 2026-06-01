import Link from 'next/link';
import { Card, CardContent } from '@retailer/ui';
import { formatMoney } from '@retailer/schema';
import type { ProductSummary } from '@/lib/catalog';

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <Link href={`/product/${product.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="p-4">
          <div className="mb-3 flex h-36 items-center justify-center overflow-hidden rounded-md bg-[var(--muted)]">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.title}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-xs text-[var(--muted-foreground)]">No image</span>
            )}
          </div>
          {product.brand ? (
            <p className="text-xs font-medium text-brand-600">{product.brand}</p>
          ) : null}
          <p className="line-clamp-2 text-sm font-medium">{product.title}</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-lg font-semibold">
              {product.minPriceMinor != null
                ? formatMoney({ amountMinor: product.minPriceMinor, currency: product.currency as 'CAD' | 'USD' })
                : '—'}
            </span>
            <span className="text-xs text-[var(--muted-foreground)]">
              {product.offerCount} store{product.offerCount === 1 ? '' : 's'}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
