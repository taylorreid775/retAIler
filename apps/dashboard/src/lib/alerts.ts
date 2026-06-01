import { db, sql } from '@retailer/db';

export interface AlertEventRow {
  id: string;
  title: string;
  type: string;
  severity: string;
  retailerName: string;
  readAt: Date | null;
  createdAt: Date;
}

export async function alertEventsForOrg(orgId: string, limit = 100): Promise<AlertEventRow[]> {
  const rows = await db.execute<{
    id: string;
    title: string;
    type: string;
    severity: string;
    retailer_name: string;
    read_at: Date | null;
    created_at: Date;
  }>(sql`
    SELECT ae.id, s.title, s.type, s.severity, r.name AS retailer_name,
           ae.read_at, ae.created_at
    FROM alert_events ae
    JOIN signals s ON s.id = ae.signal_id
    JOIN retailers r ON r.id = s.retailer_id
    WHERE ae.org_id = ${orgId}
    ORDER BY ae.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    severity: r.severity,
    retailerName: r.retailer_name,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export interface AlertRuleRow {
  id: string;
  signalTypes: string[];
  minSeverity: string;
  channels: string[];
  enabled: boolean;
}

export async function alertRulesForOrg(orgId: string): Promise<AlertRuleRow[]> {
  const rows = await db.execute<{
    id: string;
    signal_types: string[];
    min_severity: string;
    channels: string[];
    enabled: boolean;
  }>(sql`
    SELECT id, signal_types, min_severity, channels, enabled
    FROM alert_rules WHERE org_id = ${orgId} ORDER BY created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    signalTypes: r.signal_types,
    minSeverity: r.min_severity,
    channels: r.channels,
    enabled: r.enabled,
  }));
}
