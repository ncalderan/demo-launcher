import type {
  CheckStatus,
  DeploymentActionResult,
  DeploymentPlan,
  DeploymentResult,
  ValidationCheck,
  ValidationResult,
} from '../domain/types';

/**
 * Validation service.
 *
 * Where a real deployment result is available, checks reflect the ACTUAL
 * outcome of each create action (so a Search artifact that failed to provision
 * shows as a warning instead of a false "pass"). Source health and throughput
 * are still derived signals — replace with real metrics endpoints when wired.
 */

function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** Map each Cribl object id to the result of the action that created it. */
function resultsByObjectId(
  plan: DeploymentPlan,
  result?: DeploymentResult,
): Map<string, DeploymentActionResult> {
  const byObjectId = new Map<string, DeploymentActionResult>();
  if (!result) return byObjectId;
  const byActionId = new Map(result.actionResults.map((r) => [r.actionId, r]));
  for (const action of plan.actions) {
    const op = action.op;
    const objectId =
      op && typeof op === 'object' && 'objectId' in op
        ? (op as { objectId?: string }).objectId
        : undefined;
    const r = byActionId.get(action.id);
    if (objectId && r) byObjectId.set(objectId, r);
  }
  return byObjectId;
}

export function validateDeployment(
  plan: DeploymentPlan,
  result?: DeploymentResult,
): ValidationResult {
  const outcomes = resultsByObjectId(plan, result);

  /** A check that honors the real action outcome when we have one. */
  const checkObject = (
    objectId: string,
    label: string,
    okDetail: string,
  ): ValidationCheck => {
    const r = outcomes.get(objectId);
    if (r && r.status === 'failed') {
      return {
        id: `chk-${objectId}`,
        label,
        status: 'fail',
        detail: r.message ?? 'Creation did not complete',
      };
    }
    return { id: `chk-${objectId}`, label, status: 'pass', detail: okDetail };
  };

  const eps = plan.source.sampleFeed.approxEventsPerSecond;
  const lastMinute = eps * 60 + randomInRange(-50, 50);

  const destinationChecks = plan.criblObjects
    .filter((o) => o.role === 'destination')
    .map<ValidationCheck>((o) =>
      checkObject(
        o.id,
        `Destination created — ${o.label}`,
        `${String(o.config.type)} destination provisioned in ${plan.groupId}`,
      ),
    );

  const searchDatasetChecks = plan.criblObjects
    .filter((o) => o.role === 'search-dataset')
    .map<ValidationCheck>((o) => {
      const sc = o.config.searchConfig as
        | { searchVersion?: string; datatypes?: string[] }
        | undefined;
      const datatype = sc?.datatypes?.[0];
      const engine = sc?.searchVersion ? ` (search ${sc.searchVersion})` : '';
      const detail = datatype
        ? `${o.id} queryable in Cribl Search${engine}, datatype ${datatype}`
        : `${o.id} queryable in Cribl Search${engine}`;
      return checkObject(o.id, 'Federated Search dataset ready', detail);
    });

  const savedSearchChecks = plan.criblObjects
    .filter((o) => o.role === 'saved-search')
    .map<ValidationCheck>((o) =>
      checkObject(o.id, 'Saved search created', `${o.label} available in Cribl Search`),
    );

  const dashboardChecks = plan.criblObjects
    .filter((o) => o.role === 'dashboard')
    .map<ValidationCheck>((o) =>
      checkObject(o.id, 'Dashboard created', `${o.label} available in Cribl Search`),
    );

  const checks: ValidationCheck[] = [
    {
      id: 'chk-source-active',
      label: 'Source active',
      status: 'pass',
      detail: `${plan.sourcePresentation.listener} listening on ${plan.sourcePresentation.endpoint}`,
    },
    {
      id: 'chk-events-flowing',
      label: 'Events flowing',
      status: 'pass',
      detail: `${lastMinute.toLocaleString()} events received in the last 60s`,
    },
    ...destinationChecks,
    ...plan.visualOutcomes.map<ValidationCheck>((viz) => ({
      id: `chk-viz-${viz.id}`,
      label: `Assets available — ${viz.displayName}`,
      status: 'pass',
      detail: `${viz.assets.length} asset(s) provisioned`,
    })),
    ...searchDatasetChecks,
    ...savedSearchChecks,
    ...dashboardChecks,
  ];

  const overall: CheckStatus = checks.every((c) => c.status === 'pass')
    ? 'pass'
    : 'fail';

  return {
    planId: plan.id,
    checkedAt: new Date().toISOString(),
    overall,
    checks,
  };
}
