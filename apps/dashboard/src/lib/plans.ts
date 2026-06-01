import { PLAN_LIMITS, type Plan } from '@retailer/schema';

export interface PlanInfo {
  id: Exclude<Plan, 'trial'>;
  name: string;
  priceLabel: string;
  priceEnv: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceLabel: '$500/mo',
    priceEnv: 'NEXT_PUBLIC_STRIPE_PRICE_STARTER',
    features: [
      `${PLAN_LIMITS.starter.maxCompetitors} competitors`,
      `${PLAN_LIMITS.starter.maxSeats} seats`,
      'Weekly email reports',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceLabel: '$1,200/mo',
    priceEnv: 'NEXT_PUBLIC_STRIPE_PRICE_GROWTH',
    features: [
      `${PLAN_LIMITS.growth.maxCompetitors} competitors`,
      `${PLAN_LIMITS.growth.maxSeats} seats`,
      'Weekly email reports',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    priceLabel: 'Custom',
    priceEnv: 'NEXT_PUBLIC_STRIPE_PRICE_SCALE',
    features: [
      `${PLAN_LIMITS.scale.maxCompetitors} competitors`,
      `${PLAN_LIMITS.scale.maxSeats} seats`,
      'Priority support',
    ],
  },
];

/** Map a Stripe price id back to our plan (used by the webhook). */
export function planForPriceId(priceId: string | undefined | null): Plan | null {
  if (!priceId) return null;
  const map: Record<string, Plan> = {
    [process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER ?? '']: 'starter',
    [process.env.NEXT_PUBLIC_STRIPE_PRICE_GROWTH ?? '']: 'growth',
    [process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE ?? '']: 'scale',
  };
  return map[priceId] ?? null;
}

export function priceIdForPlan(planId: PlanInfo['id']): string | undefined {
  const info = PLANS.find((p) => p.id === planId);
  return info ? process.env[info.priceEnv] : undefined;
}
