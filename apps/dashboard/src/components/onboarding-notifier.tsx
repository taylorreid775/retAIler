'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  getOnboardingStatuses,
  dismissOnboarding,
  type OnboardingStatus,
} from '@/app/(app)/competitors/actions';
import { toast } from './toast';

const STORAGE_KEY = 'onboarding-seen-v1';
const POLL_MS = 5000;

function hostOf(input: string): string {
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    return new URL(withProto).host.replace(/^www\./i, '');
  } catch {
    return input;
  }
}

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // ignore quota / private-mode errors
  }
}

/**
 * Site-wide poller (mounted in the authenticated layout) that watches the org's
 * store onboarding and fires a toast exactly once when a store becomes ready or
 * fails — from any page. Dedupe state lives in localStorage so a transition
 * notifies once even across reloads/navigation.
 */
export function OnboardingNotifier() {
  const router = useRouter();
  // Avoid overlapping polls / setState after unmount.
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handle = (rows: OnboardingStatus[]) => {
      const seen = readSeen();
      let changed = false;
      let listsDirty = false;

      for (const row of rows) {
        const isTerminal = row.status === 'ready' || row.status === 'failed';
        if (!isTerminal) continue;
        if (seen[row.id] === row.status) continue;

        // First time we observe this terminal status → notify once.
        const host = hostOf(row.inputUrl);
        if (row.status === 'ready') {
          toast({ title: `${host} added`, description: 'Crawl started.', variant: 'success' });
          // The retailer is now in the tracked list; clear the transient row so
          // the DB doesn't accumulate completed onboardings. Failed rows stay
          // until the user dismisses them manually.
          void dismissOnboarding(row.id);
        } else {
          toast({
            title: `Couldn't add ${host}`,
            description: row.error || 'Discovery failed.',
            variant: 'error',
          });
        }
        seen[row.id] = row.status;
        changed = true;
        listsDirty = true;
      }

      // Drop seen ids that are no longer present (dismissed rows).
      const present = new Set(rows.map((r) => r.id));
      for (const id of Object.keys(seen)) {
        if (!present.has(id)) {
          delete seen[id];
          changed = true;
        }
      }

      if (changed) writeSeen(seen);
      if (listsDirty) router.refresh();

      return rows.some((r) => r.status === 'queued' || r.status === 'discovering');
    };

    const poll = async () => {
      if (!activeRef.current) return;
      let hasActive = false;
      try {
        const rows = await getOnboardingStatuses();
        if (!activeRef.current) return;
        hasActive = handle(rows);
      } catch {
        // transient; try again on the next tick
      }
      if (!activeRef.current) return;
      // Keep polling while work is in flight; otherwise back off to a slow idle
      // poll so newly-submitted stores from this tab still get picked up.
      timer = setTimeout(poll, hasActive ? POLL_MS : POLL_MS * 4);
    };

    void poll();

    return () => {
      activeRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return null;
}
