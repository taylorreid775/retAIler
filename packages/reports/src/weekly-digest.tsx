import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { RecentSignalRow } from '@retailer/analytics';

export interface WeeklyDigestProps {
  orgName: string;
  periodLabel: string;
  stats: { priceDrops: number; newProducts: number; inventory: number };
  highlights: RecentSignalRow[];
}

const main = { backgroundColor: '#f6f7fb', fontFamily: 'Helvetica, Arial, sans-serif' };
const container = { backgroundColor: '#ffffff', margin: '0 auto', padding: '24px', maxWidth: '600px' };
const statRow = { display: 'flex', gap: '16px' };

export function WeeklyDigest({ orgName, periodLabel, stats, highlights }: WeeklyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {stats.priceDrops} price drops, {stats.newProducts} new products from your competitors
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading as="h1" style={{ fontSize: '20px', color: '#1f2937' }}>
            Competitive intelligence — {periodLabel}
          </Heading>
          <Text style={{ color: '#6b7280' }}>Weekly summary for {orgName}.</Text>

          <Section style={statRow}>
            <StatBox label="Price drops" value={stats.priceDrops} />
            <StatBox label="New products" value={stats.newProducts} />
            <StatBox label="Inventory alerts" value={stats.inventory} />
          </Section>

          <Hr />
          <Heading as="h2" style={{ fontSize: '16px', color: '#1f2937' }}>
            Highlights
          </Heading>
          {highlights.length === 0 ? (
            <Text style={{ color: '#6b7280' }}>No notable activity this week.</Text>
          ) : (
            highlights.map((s) => (
              <Text key={s.id} style={{ margin: '6px 0', color: '#374151' }}>
                <strong>{s.retailerName}:</strong> {s.title}
              </Text>
            ))
          )}

          <Hr />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            You are receiving this because weekly intelligence reports are enabled for your plan.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, padding: '12px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
      <Text style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#111827' }}>{value}</Text>
      <Text style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>{label}</Text>
    </div>
  );
}

export default WeeklyDigest;
