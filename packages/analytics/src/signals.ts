import { db, schema, sql } from '@retailer/db';
import type { SignalSeverity, SignalType } from '@retailer/schema';

export interface SignalInput {
  type: SignalType;
  severity: SignalSeverity;
  retailerId: string;
  retailerProductId?: string | null;
  productId?: string | null;
  title: string;
  data?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Persist a signal and fan it out to alert events for every org that tracks the
 * signal's retailer and has a matching, enabled alert rule.
 */
export async function writeSignal(input: SignalInput): Promise<string> {
  const [row] = await db
    .insert(schema.signals)
    .values({
      type: input.type,
      severity: input.severity,
      retailerId: input.retailerId,
      retailerProductId: input.retailerProductId ?? null,
      productId: input.productId ?? null,
      title: input.title,
      data: input.data ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    })
    .returning({ id: schema.signals.id });
  if (!row) throw new Error('failed to insert signal');

  await fanOutAlerts(row.id, input.retailerId, input.type, input.severity);
  return row.id;
}

const severityRank: Record<SignalSeverity, number> = { info: 0, notable: 1, critical: 2 };

/** Create alert_events for orgs whose rules match this signal. */
async function fanOutAlerts(
  signalId: string,
  retailerId: string,
  type: SignalType,
  severity: SignalSeverity,
): Promise<void> {
  const rules = await db.execute<{
    org_id: string;
    rule_id: string;
    signal_types: string[];
    retailer_ids: string[];
    min_severity: SignalSeverity;
  }>(sql`
    SELECT ar.org_id, ar.id AS rule_id, ar.signal_types, ar.retailer_ids, ar.min_severity
    FROM alert_rules ar
    JOIN org_competitors oc ON oc.org_id = ar.org_id AND oc.retailer_id = ${retailerId}
    WHERE ar.enabled = true
  `);

  for (const rule of rules) {
    const typeOk = rule.signal_types.length === 0 || rule.signal_types.includes(type);
    const retailerOk = rule.retailer_ids.length === 0 || rule.retailer_ids.includes(retailerId);
    const sevOk = severityRank[severity] >= severityRank[rule.min_severity];
    if (typeOk && retailerOk && sevOk) {
      await db.insert(schema.alertEvents).values({
        orgId: rule.org_id,
        alertRuleId: rule.rule_id,
        signalId,
      });
    }
  }
}
