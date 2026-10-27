'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState<'staging' | 'production'>('staging');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), origin: f.get('origin'), environment: env, description: f.get('description'), stack: f.get('stack') ?? '' }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/app/projects/${body.projectId}`);
    else { setError(body.error ?? 'Could not create the project.'); setBusy(false); }
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label className="field"><span>Project name</span><input className="input" name="name" required minLength={2} maxLength={80} placeholder="My booking app (staging)" /></label>
      <label className="field"><span>Site origin</span><input className="input mono" name="origin" required placeholder="https://staging.example.com" inputMode="url" />
        <small className="muted">The exact origin you will verify: scheme, host and port. Paths are not allowed. Private or internal addresses are always refused.</small></label>
      <div className="field">
        <span id="env-label">Is this staging or production?</span>
        <div className="segmented" role="group" aria-labelledby="env-label">
          <button type="button" aria-pressed={env === 'staging'} onClick={() => setEnv('staging')}>Staging</button>
          <button type="button" aria-pressed={env === 'production'} onClick={() => setEnv('production')}>Production</button>
        </div>
        <small className="muted">{env === 'production'
          ? 'On production, Oddhound will not create or change data unless you explicitly allow test writes when starting a run.'
          : 'Staging with synthetic data is recommended: Oddhound can register test accounts and create, edit and cancel test records.'}</small>
      </div>
      <label className="field"><span>What does the site do? (shown to the agent)</span><textarea className="textarea" name="description" maxLength={1000} placeholder="Visitors create an account, book a table, then view, edit or cancel bookings." /></label>
      <label className="field"><span>Main framework (optional)</span><input className="input" name="stack" maxLength={60} placeholder="next.js" />
        <small className="muted">Only used to attach version-aware documentation to fix briefs. Leave empty and briefs stay framework-neutral.</small></label>
      {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Continue to verification'}</button></div>
    </form>
  );
}
