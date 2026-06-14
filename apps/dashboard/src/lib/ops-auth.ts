import { auth, currentUser } from '@clerk/nextjs/server';
import { isOpsUiEnabled } from './ops-flags';

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface OpsAccessResult {
  userId: string;
  email: string | null;
}

/** Returns null when the caller may use ops surfaces; otherwise an error message. */
export async function assertOpsAccess(): Promise<OpsAccessResult | { error: string }> {
  if (!isOpsUiEnabled()) {
    return { error: 'Ops UI disabled' };
  }

  const { userId } = await auth();
  if (!userId) {
    return { error: 'Not signed in' };
  }

  const allowIds = parseAllowlist(process.env.OPS_ADMIN_USER_IDS);
  const allowEmails = parseAllowlist(process.env.OPS_ADMIN_EMAILS).map((e) => e.toLowerCase());

  if (allowIds.length === 0 && allowEmails.length === 0) {
    return { error: 'Ops admin allowlist not configured (OPS_ADMIN_USER_IDS / OPS_ADMIN_EMAILS)' };
  }

  if (allowIds.includes(userId)) {
    const user = await currentUser();
    return { userId, email: user?.primaryEmailAddress?.emailAddress ?? null };
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
  if (email && allowEmails.includes(email)) {
    return { userId, email };
  }

  return { error: 'Insufficient permissions for ops actions' };
}

export async function canAccessOpsUi(): Promise<boolean> {
  const result = await assertOpsAccess();
  return !('error' in result);
}
