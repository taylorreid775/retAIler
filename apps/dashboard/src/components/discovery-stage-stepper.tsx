'use client';

import type { DiscoveryStage, StageCheckpoint } from '@retailer/schema';

const STAGE_ORDER: DiscoveryStage[] = [
  'fingerprint',
  'static',
  'network',
  'validate',
  'generate',
  'promote',
];

const STAGE_LABELS: Record<DiscoveryStage, string> = {
  fingerprint: 'Fingerprint',
  static: 'Site analysis',
  network: 'Network capture',
  validate: 'Validation',
  generate: 'Config generation',
  promote: 'Promotion',
};

function stageIndex(stage: DiscoveryStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function DiscoveryStageStepper({
  currentStage,
  stagesCompleted,
}: {
  currentStage: DiscoveryStage | null;
  stagesCompleted: StageCheckpoint[];
}) {
  const completed = new Map(stagesCompleted.map((s) => [s.stage, s.status]));

  return (
    <ol className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
      {STAGE_ORDER.map((stage) => {
        const status = completed.get(stage);
        const isDone = status === 'completed' || status === 'skipped';
        const isActive = currentStage === stage && !isDone;
        const isPending =
          !isDone &&
          !isActive &&
          (currentStage ? stageIndex(stage) > stageIndex(currentStage) : true);

        return (
          <li
            key={stage}
            className={
              isDone
                ? 'text-brand-600'
                : isActive
                  ? 'font-semibold text-[var(--foreground)]'
                  : isPending
                    ? 'opacity-50'
                    : ''
            }
          >
            {isDone ? '✓ ' : isActive ? '● ' : '○ '}
            {STAGE_LABELS[stage]}
          </li>
        );
      })}
    </ol>
  );
}
