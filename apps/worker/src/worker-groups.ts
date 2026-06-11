export type WorkerGroup = 'crawl' | 'discovery' | 'all';

const VALID_GROUPS = new Set<WorkerGroup>(['crawl', 'discovery', 'all']);

/** Parse `--workers=crawl`, `--workers=discovery`, or `--workers=all` from argv. */
export function parseWorkerGroups(argv: string[]): Set<WorkerGroup> {
  const explicit = argv
    .filter((arg) => arg.startsWith('--workers='))
    .map((arg) => arg.slice('--workers='.length).trim() as WorkerGroup);

  if (explicit.length === 0) {
    return new Set<WorkerGroup>(['all']);
  }

  const groups = new Set<WorkerGroup>();
  for (const group of explicit) {
    if (VALID_GROUPS.has(group)) groups.add(group);
  }
  return groups.size > 0 ? groups : new Set<WorkerGroup>(['all']);
}

export function shouldStartWorker(
  groups: Set<WorkerGroup>,
  group: Exclude<WorkerGroup, 'all'>,
): boolean {
  return groups.has('all') || groups.has(group);
}
