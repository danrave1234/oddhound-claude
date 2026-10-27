'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState<'staging' | 'production'>('staging');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const origin = String(f.get('origin') ?? '').trim();
    let name = String(f.get('name') ?? '').trim();
    if (!name) { try { name = new URL(origin).hostname; } catch { name = origin; } }
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, origin, environment: env, description: f.get('description'), stack: f.get('stack') ?? '' }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/app/projects/${body.projectId}`);
    else { setError(body.error ?? 'Could not create the project.'); setBusy(false); }
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 0 }}>
      <div className="form-section">
        <label className="field"><span>Site origin</span>
          <input className="input mono" name="origin" required placeholder="https://staging.example.com" inputMode="url" autoComplete="url" autoFocus aria-describedby="origin-hint" />
          <small id="origin-hint">Scheme, host and port only — no path. Private or internal addresses are always refused.</small></label>
        <label className="field"><span>Project name <span className="muted" style={{ fontWeight: 400 }}>— optional, defaults to the hostname</span></span><input className="input" name="name" minLength={2} maxLength={80} placeholder="My booking app (staging)" /></label>
      </div>

      <div className="form-section">
        <div className="field">
          <span id="env-label">Is this staging or production?</span>
          <div className="segmented segmented-lg" role="group" aria-labelledby="env-label" style={{ justifySelf: 'start' }}>
            <button type="button" aria-pressed={env === 'staging'} onClick={() => setEnv('staging')}>Staging</button>
            <button type="button" aria-pressed={env === 'production'} onClick={() => setEnv('production')}>Production</button>
          </div>
          <div className={`note ${env === 'production' ? 'note-warn' : 'note-info'} fade-in`} key={env} style={{ boxShadow: 'none', padding: '10px 12px', marginTop: 4 }}>
            <span className="note-icon" style={{ width: 26, height: 26 }}><Icon name={env === 'production' ? 'alert' : 'info'} /></span>
            <small style={{ color: 'var(--text-2)', alignSelf: 'center' }}>{env === 'production'
              ? 'On production, Oddhound will not create or change data unless you explicitly allow test writes when starting a run.'
              : 'Recommended. With synthetic data, Oddhound can register test accounts and create, edit and cancel test records.'}</small>
          </div>
        </div>
      </div>

      <div className="form-section">
        <label className="field"><span>What does the site do? <span className="muted" style={{ fontWeight: 400 }}>— shown to the agent</span></span>
          <textarea className="textarea" name="description" maxLength={1000} placeholder="Visitors create an account, book a table, then view, edit or cancel bookings." /></label>
        <label className="field"><span>Main framework <span className="muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" name="stack" maxLength={60} placeholder="next.js" aria-describedby="stack-hint" />
          <small id="stack-hint">Only used to attach version-aware docs to fix briefs. Leave empty and briefs stay framework-neutral.</small></label>
      </div>

      {error && <p role="alert" className="status-line" style={{ color: 'var(--bad)', marginBottom: 12 }}><Icon name="fail" /> {error}</p>}
      <div className="sticky-actions">
        <button className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Creating…' : 'Continue to verification'}</button>
        <span className="muted" style={{ fontSize: 12.5 }}>Step 1 of 3</span>
      </div>
    </form>
  );
}
