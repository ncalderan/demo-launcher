import type { CheckStatus, DeploymentStatus } from '../domain/types';

type AnyStatus = CheckStatus | DeploymentStatus;

const LABELS: Record<AnyStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  pending: 'Pending',
  skipped: 'Skipped',
  idle: 'Idle',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

/** Small colored status pill for checks and deployment states. */
export function StatusBadge({ status }: { status: AnyStatus }) {
  return <span className={`status-badge is-${status}`}>{LABELS[status]}</span>;
}
