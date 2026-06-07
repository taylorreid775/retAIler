import '../load-env.js';
import { db, schema, eq, count } from '@retailer/db';

const key = process.argv[2];
if (!key) {
  console.error('usage: count-products <retailerKey>');
  process.exit(1);
}

const [retailer] = await db
  .select({ id: schema.retailers.id, name: schema.retailers.name })
  .from(schema.retailers)
  .where(eq(schema.retailers.key, key));
if (!retailer) {
  console.error('unknown retailer', key);
  process.exit(1);
}

const [{ value: productCount } = { value: 0 }] = await db
  .select({ value: count() })
  .from(schema.retailerProducts)
  .where(eq(schema.retailerProducts.retailerId, retailer.id));

console.log(retailer.name, 'products:', productCount);
process.exit(0);
