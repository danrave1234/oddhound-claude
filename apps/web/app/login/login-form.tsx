'use client';
import { useState } from 'react';
import { createAuthClient } from 'better-auth/react';

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
    <div style={{ display: 'grid', gap: 16 }}>
      {github
        ? <button className="btn btn-primary btn-lg" onClick={() => client.signIn.social({ provider: 'github', callbackURL: next })}>Continue with GitHub</button>
        : <p className="muted" style={{ margin: 0 }}>GitHub sign-in is not configured on this deployment.</p>}
      {devLogin && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--separator)', paddingTop: 14 }} aria-labelledby="dev-login">
          <div id="dev-login" className="section-title">Local development sign-in</div>
          <div className="segmented" role="group" aria-label="Sign in or create account">
            <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
          </div>
          {mode === 'up' && <label className="field"><span>Name</span><input className="input" name="name" autoComplete="name" /></label>}
          <label className="field"><span>Email</span><input className="input" name="email" type="email" required autoComplete="email" /></label>
          <label className="field"><span>Password (10+ characters)</span><input className="input" name="password" type="password" required minLength={10} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
          {error && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
          <button className="btn" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
      )}
    </div>
  );
}
