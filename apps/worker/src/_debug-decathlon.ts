import { db, schema, eq, desc, sql } from '@retailer/db';

async function main() {
  const dec = await db.query.retailers.findFirst({ where: eq(schema.retailers.key, 'decathlon') });
  if (!dec) return console.log('no decathlon');

  const [run] = await db
    .select()
    .from(schema.crawlRuns)
    .where(eq(schema.crawlRuns.retailerId, dec.id))
    .orderBy(desc(schema.crawlRuns.startedAt))
    .limit(1);
  console.log('run', run);

  const [count] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.retailerProducts)
    .where(eq(schema.retailerProducts.retailerId, dec.id));
  console.log('products', count?.n);
}

main();
