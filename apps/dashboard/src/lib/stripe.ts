import Stripe from 'stripe';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  client = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
