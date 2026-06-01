import { SearchBar } from '@/components/search-bar';
import { ProductCard } from '@/components/product-card';
import { popularProducts } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let products: Awaited<ReturnType<typeof popularProducts>> = [];
  try {
    products = await popularProducts(12);
  } catch {
    products = [];
  }

  return (
    <div className="space-y-10">
      <section className="flex flex-col items-center gap-4 py-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Find the cheapest price, across Canadian retailers
        </h1>
        <p className="max-w-xl text-[var(--muted-foreground)]">
          We compare live prices from Sport Chek, MEC, Sporting Life and more so you don&apos;t have
          to.
        </p>
        <SearchBar />
      </section>

      {products.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Popular right now</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-center text-sm text-[var(--muted-foreground)]">
          No products yet — run a crawl to populate the catalog.
        </p>
      )}
    </div>
  );
}
