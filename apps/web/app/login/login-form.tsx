'use client';
import { useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { Icon } from '@/ui/icons';

const client = createAuthClient();

export function LoginForm({ github, devLogin, next }: { github: boolean; devLogin: boolean; next: string }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')), password = String(f.get('password')), name = String(f.get('name') ?? '') || email.split('@')[0]!;
    const res = mode === 'in'
      ? await client.signIn.email({ email, password })
      : await client.signUp.email({ email, password, name });
    if (res.error) { setError(res.error.message ?? 'Sign-in failed.'); setBusy(false); return; }
    window.location.assign(next);
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {github
        ? <button className="btn btn-primary btn-lg btn-block" onClick={() => client.signIn.social({ provider: 'github', callbackURL: next })}><Icon name="signin" /> Continue with GitHub</button>
        : <div className="well row" style={{ gap: 8, flexWrap: 'nowrap', fontSize: 13 }}><Icon name="info" /><span className="muted">GitHub sign-in is not configured on this deployment.</span></div>}
      {devLogin && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} aria-labelledby="dev-login">
          <div id="dev-login" className="divider-label">Local development sign-in</div>
          <div className="segmented" role="group" aria-label="Sign in or create account" style={{ justifySelf: 'center' }}>
            <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
          </div>
          {mode === 'up' && <label className="field fade-in"><span>Name</span><input className="input" name="name" autoComplete="name" /></label>}
          <label className="field"><span>Email</span><input className="input" name="email" type="email" required autoComplete="email" /></label>
          <label className="field"><span>Password <span className="muted" style={{ fontWeight: 400 }}>— 10+ characters</span></span><input className="input" name="password" type="password" required minLength={10} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
          {error && <p role="alert" className="status-line" style={{ color: 'var(--bad)' }}><Icon name="fail" /> {error}</p>}
          <button className={`btn btn-block ${github ? '' : 'btn-primary'}`} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
      )}
    </div>
  );
}
