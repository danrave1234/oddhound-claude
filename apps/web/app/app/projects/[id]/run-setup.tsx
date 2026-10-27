'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/ui/icons';
import { BASELINE_RULES, DEFAULT_DENIED_PATH_KEYWORDS, DEFAULT_DENIED_OPERATIONS } from '@core/contracts/contract.ts';

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function Option({ name, icon, title, desc, defaultChecked, checked, onChange, children }: {
  name: string; icon: IconName; title: React.ReactNode; desc?: React.ReactNode; defaultChecked?: boolean; checked?: boolean; onChange?: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="option-row">
        <input type="checkbox" name={name} defaultChecked={onChange ? undefined : defaultChecked} checked={onChange ? checked : undefined} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} />
        <span className="opt-icon"><Icon name={icon} /></span>
        <span className="opt-body"><span className="opt-title">{title}</span>{desc && <span className="opt-desc">{desc}</span>}</span>
      </label>
      {children}
    </div>
  );
}

export function RunSetup({ projectId, environment }: { projectId: string; environment: 'staging' | 'production' }) {
  const router = useRouter();
  const [mode, setMode] = useState<'active' | 'observation_only'>(environment === 'production' ? 'observation_only' : 'active');
  const [ack, setAck] = useState(false);
  const [handoff, setHandoff] = useState(false);
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
      deniedPathKeywords: String(f.get('keywords') ?? '').split(/[\s,]+/).map((k) => k.trim().toLowerCase()).filter(Boolean),
      handoff: { enabled: Boolean(f.get('handoff')), startPath: String(f.get('startPath') || '/login') },
      ...(username && password ? { account: { username, password, label: 'Owner test account' } } : {}),
    }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/runs/${body.runId}`);
    else { setError(body.error ?? 'Could not start the run.'); setBusy(false); }
  }
  const needsAck = environment === 'production' && mode === 'active';
  return (
    <form onSubmit={submit} style={{ display: 'grid' }}>
      <div className="form-section">
        <h3 className="h3" id="mode">Testing mode</h3>
        <div className="segmented segmented-lg" role="group" aria-labelledby="mode" style={{ justifySelf: 'start' }}>
          <button type="button" aria-pressed={mode === 'active'} onClick={() => setMode('active')}><Icon name="sniff" /> Active testing</button>
          <button type="button" aria-pressed={mode === 'observation_only'} onClick={() => setMode('observation_only')}><Icon name="eye" /> Observation only</button>
        </div>
        <small className="muted fade-in" key={mode}>{mode === 'active' ? 'The agent may sign up synthetic accounts and create, edit and cancel its own test records — no per-click approval.' : 'The agent explores and reads but never submits forms that change data.'}</small>
        {needsAck && (
          <label className="note note-warn fade-in" style={{ cursor: 'pointer', boxShadow: 'none' }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} required />
            <span style={{ fontSize: 13.5 }}>I understand this is a <strong>production</strong> site and allow test writes with synthetic accounts and data. Actions the site completes cannot be undone by Oddhound.</span>
          </label>
        )}
      </div>

      <div className="form-section">
        <h3 className="h3">Sign-in</h3>
        <div className="option-list">
          <Option name="handoff" icon="pointer" checked={handoff} onChange={setHandoff}
            title="My site needs sign-in — I’ll sign in myself first"
            desc="The run opens a live view of its browser. Sign in however you normally do (password, Google, 2FA), then hand over. No test account needed, and your sign-in is never shown to the AI model.">
            {handoff && (
              <div className="opt-extra fade-in">
                <label className="field" style={{ maxWidth: 320 }}><span>Sign-in page</span><input className="input mono" name="startPath" defaultValue="/login" /></label>
              </div>
            )}
          </Option>
        </div>
      </div>

      <div className="form-section">
        <h3 className="h3">What Oddhound checks</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>The agent maps your site, writes its own risk-ranked test plan and works through it. Nothing to fill in here unless you want to steer it.</p>
        <details className="well" style={{ fontSize: 13.5 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Baseline rules checked on every site ({BASELINE_RULES.length})</summary>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
            {BASELINE_RULES.map((r) => <li key={r.id}><span className="mono muted">{r.id}</span> {r.text}</li>)}
          </ul>
        </details>
        <label className="field"><span>Focus areas <span className="muted" style={{ fontWeight: 400 }}>— optional, one per line</span></span>
          <textarea className="textarea" name="goals" rows={2} placeholder="The checkout-free booking flow. The new notes editor." aria-describedby="goals-hint" />
          <small id="goals-hint">Tested early. They set priorities; they never limit what the agent tests.</small></label>
        <label className="field"><span>Your own rules <span className="muted" style={{ fontWeight: 400 }}>— optional, one per line</span></span>
          <textarea className="textarea" name="rules" rows={2} placeholder="A booking must have between 1 and 8 guests." aria-describedby="rules-hint" />
          <small id="rules-hint">Business rules only you know. Findings are judged against these and the baseline rules.</small></label>
      </div>

      <fieldset className="form-section" style={{ border: 0, margin: 0 }}>
        <legend className="h3" style={{ padding: 0, marginBottom: 12, float: 'left', width: '100%' }}>Capabilities</legend>
        <div className="option-list" style={{ clear: 'both' }}>
          <Option name="register" icon="person" defaultChecked={mode === 'active'} title="Register synthetic accounts" desc="Up to 3 per run.">
            <div className="opt-extra">
              <label className="field" style={{ maxWidth: 320 }}><span>Synthetic email domain</span><input className="input mono" name="emailDomain" defaultValue="example.test" /></label>
            </div>
          </Option>
          <Option name="secondActor" icon="lock" defaultChecked={mode === 'active'} title="Two-account check" desc="A second account tries to reach records the agent created itself." />
          <Option name="device_desktop" icon="desktop" defaultChecked title="Desktop" desc="1440 × 900" />
          <Option name="device_mobile" icon="mobile" defaultChecked title="Phone" desc="390 × 844, emulated" />
        </div>
      </fieldset>

      <div className="form-section">
        <details className="disclosure">
          <summary><span className="chev"><Icon name="chevron" /></span><Icon name="shield" /> Blocked areas and optional test account <span className="chip chip-accent" style={{ marginLeft: 'auto' }}>Safe defaults on</span></summary>
          <div className="disclosure-body">
            <label className="field"><span>Never open URLs containing these words</span><textarea className="textarea mono" name="keywords" defaultValue={DEFAULT_DENIED_PATH_KEYWORDS.join(', ')} /></label>
            <label className="field"><span>Denied path prefixes <span className="muted" style={{ fontWeight: 400 }}>— one per line</span></span><textarea className="textarea mono" name="denied" placeholder="/admin&#10;/billing" /></label>
            <label className="field"><span>Denied operations <span className="muted" style={{ fontWeight: 400 }}>— one per line</span></span><textarea className="textarea" name="deniedOps" defaultValue={DEFAULT_DENIED_OPERATIONS.join(String.fromCharCode(10))} /></label>
            <hr className="sep" />
            <div className="grid-2">
              <label className="field"><span>Test account username or email</span><input className="input" name="username" autoComplete="off" /></label>
              <label className="field"><span>Test account password</span><input className="input" name="password" type="password" autoComplete="new-password" aria-describedby="pw-hint" /></label>
            </div>
            <small id="pw-hint" className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="lock" /> Encrypted, and never shown to the model.</small>
          </div>
        </details>
      </div>

      {error && <p role="alert" className="status-line" style={{ color: 'var(--bad)', marginBottom: 12 }}><Icon name="fail" /> {error}</p>}
      <div className="sticky-actions">
        <button className="btn btn-primary" disabled={busy || (needsAck && !ack)} aria-busy={busy || undefined}><Icon name="play" /> {busy ? 'Starting…' : 'Start run'}</button>
        <span className="muted" style={{ fontSize: 12.5 }}>Each run stops at 15 minutes, 250 actions or $2 of model spend, at one action per second.</span>
      </div>
    </form>
  );
}
