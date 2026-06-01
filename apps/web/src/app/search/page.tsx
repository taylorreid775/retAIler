import { SearchBar } from '@/components/search-bar';
import { ProductCard } from '@/components/product-card';
import { searchProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  let results: Awaited<ReturnType<typeof searchProducts>> = [];
  if (q.trim()) {
    try {
      results = await searchProducts(q, 48);
    } catch {
      results = [];
    }
  }

  return (
    <div className="space-y-8">
      <SearchBar initial={q} />
      <div>
        <h1 className="mb-1 text-xl font-semibold">
          {q ? `Results for “${q}”` : 'Search'}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">{results.length} products</p>
      </div>
      {results.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          {q ? 'No matching products found.' : 'Type something to search.'}
        </p>
      )}
    </div>
  );
}
