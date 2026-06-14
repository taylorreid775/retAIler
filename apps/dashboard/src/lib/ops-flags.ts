/** Ops-only dashboard surfaces (rollback, discovery cost). */
export function isOpsUiEnabled(): boolean {
  return process.env.ENABLE_OPS_UI === 'true';
}
