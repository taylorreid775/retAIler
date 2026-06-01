'use server';

import { headers } from 'next/headers';
import { db, schema, eq } from '@retailer/db';
import { getTenant } from '@/lib/tenant';
import { stripe } from '@/lib/stripe';
import { priceIdForPlan, type PlanInfo } from '@/lib/plans';

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export async function startCheckout(planId: PlanInfo['id']): Promise<{ url?: string; error?: string }> {
  const tenant = await getTenant();
  if (!tenant) return { error: 'No organization selected' };
  const priceId = priceIdForPlan(planId);
  if (!priceId) return { error: `Price not configured for ${planId}` };

  const url = await baseUrl();
  let customerId = tenant.org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({
      name: tenant.org.name,
      metadata: { orgId: tenant.org.id, clerkOrgId: tenant.org.clerkOrgId },
    });
    customerId = customer.id;
    await db
      .update(schema.orgs)
      .set({ stripeCustomerId: customerId })
      .where(eq(schema.orgs.id, tenant.org.id));
  }

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${url}/billing?status=success`,
    cancel_url: `${url}/billing?status=cancelled`,
    metadata: { orgId: tenant.org.id },
  });

  return { url: session.url ?? undefined };
}

export async function openPortal(): Promise<{ url?: string; error?: string }> {
  const tenant = await getTenant();
  if (!tenant?.org.stripeCustomerId) return { error: 'No billing account yet' };
  const url = await baseUrl();
  const session = await stripe().billingPortal.sessions.create({
    customer: tenant.org.stripeCustomerId,
    return_url: `${url}/billing`,
  });
  return { url: session.url };
}
