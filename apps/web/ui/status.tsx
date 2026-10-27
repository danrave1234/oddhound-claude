// Shared status vocabulary (MVP §10) with non-colour cues: every badge has a label and an icon shape.
import { Icon, type IconName } from './icons';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'muted';
const MAP: Record<string, { label: string; tone: Tone; icon: IconName }> = {
  // run status
  queued: { label: 'Queued', tone: 'muted', icon: 'dot' }, provisioning: { label: 'Starting browser', tone: 'info', icon: 'dot' },
  running: { label: 'Running', tone: 'info', icon: 'play' }, waiting_for_input: { label: 'Waiting for input', tone: 'warn', icon: 'alert' },
  stopping: { label: 'Stopping', tone: 'warn', icon: 'stop' }, finalizing: { label: 'Finalizing', tone: 'info', icon: 'dot' },
  completed: { label: 'Completed', tone: 'ok', icon: 'check' }, stopped: { label: 'Stopped', tone: 'warn', icon: 'stop' },
  failed: { label: 'Failed', tone: 'bad', icon: 'fail' }, blocked: { label: 'Blocked', tone: 'warn', icon: 'alert' },
  // workflow
  discovered: { label: 'Discovered', tone: 'muted', icon: 'dot' }, exploring: { label: 'Exploring', tone: 'info', icon: 'play' },
  testing: { label: 'Testing', tone: 'info', icon: 'play' },
  // scenario outcomes
  not_run: { label: 'Not run', tone: 'muted', icon: 'skip' }, passed: { label: 'Passed', tone: 'ok', icon: 'check' },
  inconclusive: { label: 'Inconclusive', tone: 'warn', icon: 'question' }, skipped: { label: 'Skipped', tone: 'muted', icon: 'skip' },
  // finding verification / lifecycle / category
  candidate: { label: 'Candidate', tone: 'muted', icon: 'question' }, verifying: { label: 'Verifying', tone: 'info', icon: 'dot' },
  verified: { label: 'Verified', tone: 'bad', icon: 'bug' }, dismissed: { label: 'Dismissed', tone: 'muted', icon: 'skip' },
  open: { label: 'Open', tone: 'bad', icon: 'bug' }, fixed: { label: 'Fixed', tone: 'ok', icon: 'check' }, regressed: { label: 'Regressed', tone: 'bad', icon: 'fail' },
  verified_issue: { label: 'Verified issue', tone: 'bad', icon: 'bug' }, configuration_observation: { label: 'Configuration observation', tone: 'info', icon: 'shield' },
  needs_review: { label: 'Needs review', tone: 'warn', icon: 'question' }, suggestion: { label: 'Suggestion', tone: 'muted', icon: 'eye' },
  observed: { label: 'Observed', tone: 'info', icon: 'eye' },
  // connection
  live: { label: 'Live', tone: 'ok', icon: 'dot' }, reconnecting: { label: 'Reconnecting', tone: 'warn', icon: 'retest' }, stale: { label: 'Stale', tone: 'warn', icon: 'alert' },
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const s = MAP[value] ?? { label: value.replace(/_/g, ' '), tone: 'muted' as Tone, icon: 'dot' as IconName };
  return <span className={`badge badge-${s.tone}`}><Icon name={s.icon} />{s.label}</span>;
}

/** Finding status to display: configuration observations are observed facts, not verified defects. */
export const findingStatus = (f: { category: string; verification: string; lifecycle: string | null }) =>
  f.category === 'configuration_observation' ? 'observed' : (f.lifecycle ?? f.verification);

export const statusLabel = (v: string) => MAP[v]?.label ?? v.replace(/_/g, ' ');
