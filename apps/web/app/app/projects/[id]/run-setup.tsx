'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function RunSetup({ projectId, environment }: { projectId: string; environment: 'staging' | 'production' }) {
  const router = useRouter();
  const [mode, setMode] = useState<'active' | 'observation_only'>(environment === 'production' ? 'observation_only' : 'active');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const username = String(f.get('username') ?? '').trim(), password = String(f.get('password') ?? '');
    const devices = ['desktop', 'mobile'].filter((d) => f.get(`device_${d}`));
    const res = await fetch(`/api/projects/${projectId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      testMode: mode, productionWritesAcknowledged: ack, goals: lines(String(f.get('goals'))), rules: lines(String(f.get('rules'))),
      allowRegistration: Boolean(f.get('register')), emailDomain: String(f.get('emailDomain') || 'example.test'), secondActor: Boolean(f.get('secondActor')),
      devices: devices.length ? devices : ['desktop'], deniedPathPrefixes: lines(String(f.get('denied') ?? '')).filter((l) => l.startsWith('/')),
      deniedOperations: lines(String(f.get('deniedOps') ?? '')),
      ...(username && password ? { account: { username, password, label: 'Owner test account' } } : {}),
    }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/runs/${body.runId}`);
    else { setError(body.error ?? 'Could not start the run.'); setBusy(false); }
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <div className="field"><span id="mode">Testing mode</span>
        <div className="segmented" role="group" aria-labelledby="mode">
          <button type="button" aria-pressed={mode === 'active'} onClick={() => setMode('active')}>Active testing</button>
          <button type="button" aria-pressed={mode === 'observation_only'} onClick={() => setMode('observation_only')}>Observation only</button>
        </div>
        <small className="muted">{mode === 'active' ? 'The agent may sign up synthetic accounts and create, edit and cancel its own test records — no per-click approval.' : 'The agent explores and reads but never submits forms that change data.'}</small>
      </div>
      {environment === 'production' && mode === 'active' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
          <span>I understand this is a <strong>production</strong> site and allow test writes with synthetic accounts and data. Actions the site completes cannot be undone by Oddhound.</span></label>
      )}
      <label className="field"><span>Goals (one per line)</span><textarea className="textarea" name="goals" required defaultValue={'Create an account and sign in.\nComplete the main workflow.\nTry unexpected inputs and orderings and check the rules hold.'} /></label>
      <label className="field"><span>Rules the site must follow (one per line; findings are judged only against these)</span><textarea className="textarea" name="rules" placeholder="A booking must have between 1 and 8 guests." /></label>
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
        <legend className="section-title">Capabilities</legend>
        <label><input type="checkbox" name="register" defaultChecked={mode === 'active'} /> Register synthetic accounts (max 3 per run)</label>
        <label className="field" style={{ maxWidth: 320 }}><span>Synthetic email domain</span><input className="input mono" name="emailDomain" defaultValue="example.test" /></label>
        <label><input type="checkbox" name="secondActor" /> Two-account check on records the agent creates itself</label>
        <label><input type="checkbox" name="device_desktop" defaultChecked /> <Icon name="desktop" /> Desktop 1440×900</label>
        <label><input type="checkbox" name="device_mobile" defaultChecked /> <Icon name="mobile" /> Phone 390×844 (emulation)</label>
      </fieldset>
      <details>
        <summary>Existing test account and denied areas (optional)</summary>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <label className="field"><span>Test account username or email</span><input className="input" name="username" autoComplete="off" /></label>
          <label className="field"><span>Test account password (encrypted; never shown to the model)</span><input className="input" name="password" type="password" autoComplete="new-password" /></label>
          <label className="field"><span>Denied path prefixes (one per line)</span><textarea className="textarea" name="denied" placeholder="/admin&#10;/billing" /></label>
          <label className="field"><span>Denied operations (one per line)</span><textarea className="textarea" name="deniedOps" placeholder="Never send messages to customers." /></label>
        </div>
      </details>
      {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div><button className="btn btn-primary" disabled={busy || (environment === 'production' && mode === 'active' && !ack)}><Icon name="play" /> {busy ? 'Starting…' : 'Start run'}</button>
        <span className="muted" style={{ marginLeft: 10 }}>Limits: 15 minutes, 250 actions, $2 of model spend, 1 action per second.</span></div>
    </form>
  );
}
