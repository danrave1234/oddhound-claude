// Canonical status vocabulary (MVP plan §10). Every table, event and UI label uses these values.

export const RUN_STATUSES = [
  'queued', 'provisioning', 'running', 'waiting_for_input', 'stopping', 'finalizing',
  'completed', 'stopped', 'failed', 'blocked',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'stopped', 'failed', 'blocked'];

export const BROWSER_LIFECYCLE = ['provisioning', 'ready', 'active', 'terminating', 'terminated'] as const;
export type BrowserLifecycle = (typeof BROWSER_LIFECYCLE)[number];

export const WORKFLOW_STATUSES = ['discovered', 'queued', 'exploring', 'testing', 'blocked', 'completed'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const SCENARIO_OUTCOMES = ['not_run', 'passed', 'failed', 'blocked', 'inconclusive', 'skipped'] as const;
export type ScenarioOutcome = (typeof SCENARIO_OUTCOMES)[number];

export const FINDING_VERIFICATION = ['candidate', 'verifying', 'verified', 'inconclusive', 'dismissed'] as const;
export type FindingVerification = (typeof FINDING_VERIFICATION)[number];

export const FINDING_LIFECYCLE = ['open', 'fixed', 'regressed'] as const;
export type FindingLifecycle = (typeof FINDING_LIFECYCLE)[number];

export const FINDING_CATEGORIES = ['verified_issue', 'configuration_observation', 'needs_review', 'suggestion'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const CONNECTION_STATES = ['live', 'reconnecting', 'stale'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const TARGET_ENVIRONMENTS = ['staging', 'production'] as const;
export type TargetEnvironment = (typeof TARGET_ENVIRONMENTS)[number];

export const TEST_MODES = ['active', 'observation_only'] as const;
export type TestMode = (typeof TEST_MODES)[number];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}
