'use client';

import { useState, useTransition } from 'react';
import { Button } from '@retailer/ui';
import type { SignalSeverity, SignalType } from '@retailer/schema';
import { createAlertRule } from './actions';

const SIGNAL_TYPES: { value: SignalType; label: string }[] = [
  { value: 'price_drop', label: 'Price drops' },
  { value: 'price_increase', label: 'Price increases' },
  { value: 'new_product', label: 'New products' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'assortment_expansion', label: 'Assortment expansion' },
];

export function AlertRuleForm() {
  const [selected, setSelected] = useState<Set<SignalType>>(new Set());
  const [minSeverity, setMinSeverity] = useState<SignalSeverity>('notable');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pending, startTransition] = useTransition();

  const toggleType = (t: SignalType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const submit = () =>
    startTransition(async () => {
      await createAlertRule({
        signalTypes: Array.from(selected),
        minSeverity,
        emailEnabled,
      });
      setSelected(new Set());
    });

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm font-medium">New alert rule</p>
      <div className="flex flex-wrap gap-2">
        {SIGNAL_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => toggleType(t.value)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selected.has(t.value)
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-[var(--border)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Min severity:
          <select
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value as SignalSeverity)}
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
          >
            <option value="info">Info</option>
            <option value="notable">Notable</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
          />
          Email me
        </label>
      </div>
      <Button size="sm" disabled={pending || selected.size === 0} onClick={submit}>
        Create rule
      </Button>
    </div>
  );
}
