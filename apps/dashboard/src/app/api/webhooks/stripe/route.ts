import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { db, schema, eq } from '@retailer/db';
import { stripe } from '@/lib/stripe';
import { planForPriceId } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook: keep org plan + subscription state in sync. Handles checkout
 * completion and subscription lifecycle (create/update/delete).
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `invalid signature: ${String(err)}` }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const orgId = session.metadata?.orgId;
      if (orgId && session.subscription) {
        const sub = await stripe().subscriptions.retrieve(session.subscription as string);
        await applySubscription(orgId, sub);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object;
      await applySubscriptionByCustomer(sub);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const [org] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.stripeCustomerId, sub.customer as string));
      if (org) {
        await db
          .update(schema.orgs)
          .set({ plan: 'trial', stripeSubscriptionId: null })
          .where(eq(schema.orgs.id, org.id));
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

async function applySubscription(orgId: string, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price.id;
  const plan = planForPriceId(priceId);
  await db
    .update(schema.orgs)
    .set({
      plan: plan ?? 'starter',
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
    })
    .where(eq(schema.orgs.id, orgId));
}

async function applySubscriptionByCustomer(sub: Stripe.Subscription): Promise<void> {
  const [org] = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.stripeCustomerId, sub.customer as string));
  if (org) await applySubscription(org.id, sub);
}
