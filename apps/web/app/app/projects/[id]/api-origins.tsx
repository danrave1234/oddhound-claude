'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';
import { VerifyPanel } from './verify-panel';

type Api = { origin: string; token: string; verified: boolean; lastReason: string | null; lastChecked: string | null };

/** The site's own API hosts. Sign-up, login and saves often go to one; each must be verified separately. */
export function ApiOrigins({ projectId, siteOrigin, apis }: { projectId: string; siteOrigin: string; apis: Api[] }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call(method: 'POST' | 'DELETE', origin: string) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/projects/${projectId}/api-origins`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? 'Could not save.'); return; }
    if (method === 'POST') setValue('');
    router.refresh();
  }
  return (
    <div style={{ display: 'grid', gap: 14, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--separator)' }}>
      <div>
        <h3 className="h3" style={{ margin: 0 }}>API on another host <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></h3>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
          If {new URL(siteOrigin).hostname} sends sign-up, login or saves to another host you own, add it here. Oddhound only sends changes to hosts you have verified.
        </p>
      </div>
      {apis.map((a) => (
        <div key={a.origin} className="well" style={{ display: 'grid', gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono break" style={{ fontSize: 13.5 }}>{a.origin}</span>
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => call('DELETE', a.origin)} aria-label={`Remove ${a.origin}`}>Remove</button>
          </div>
          <VerifyPanel projectId={projectId} origin={a.origin} token={a.token} verified={a.verified} lastReason={a.lastReason} lastChecked={a.lastChecked} apiOrigin initialMethod="dns_txt" />
        </div>
      ))}
      {apis.length < 4 && (
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (value.trim()) void call('POST', value.trim()); }}>
          <input className="input mono" style={{ flex: 1, minWidth: 0 }} placeholder="https://api.example.com" value={value} onChange={(e) => setValue(e.target.value)} aria-label="API origin" />
          <button className="btn" type="submit" disabled={busy || !value.trim()}><Icon name="plus" /> Add API host</button>
        </form>
      )}
      {error && <p role="alert" className="status-line" style={{ color: 'var(--bad)', margin: 0 }}><Icon name="fail" /> {error}</p>}
    </div>
  );
}
