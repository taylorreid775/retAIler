import { NextResponse } from 'next/server';
import { db, schema, eq } from '@retailer/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Affiliate link-out: resolve a retailer product to its outbound URL, append
 * the retailer's affiliate tag if configured, and redirect. This is also the
 * natural place to record click-throughs for attribution.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const [row] = await db
    .select({
      url: schema.retailerProducts.url,
      affiliateTag: schema.retailers.affiliateTag,
    })
    .from(schema.retailerProducts)
    .innerJoin(schema.retailers, eq(schema.retailers.id, schema.retailerProducts.retailerId))
    .where(eq(schema.retailerProducts.id, id));

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let target = row.url;
  if (row.affiliateTag) {
    const u = new URL(row.url);
    u.searchParams.set('aff', row.affiliateTag);
    target = u.toString();
  }

  return NextResponse.redirect(target, 302);
}
