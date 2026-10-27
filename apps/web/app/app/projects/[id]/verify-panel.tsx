'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';

type Method = 'dns_txt' | 'well_known_file' | 'meta_tag';

function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
      <input className="input mono" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(value).then(() => setState('copied'), () => setState('failed'))}>
        <Icon name="copy" /> {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span role="status" className="sr-only">{state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed; select the text manually' : ''}</span>
    </div>
  );
}

export function VerifyPanel({ projectId, origin, token, verified, lastReason, lastChecked }: { projectId: string; origin: string; token: string; verified: boolean; lastReason: string | null; lastChecked: string | null }) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>('well_known_file');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; reason: string } | null>(null);
  const host = new URL(origin).hostname;
  async function check() {
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method }) });
    setResult(await res.json());
    setBusy(false);
    router.refresh();
  }
  const reasons: Record<string, string> = {
    token_found: 'Token found. The site is verified.', token_not_found: 'No matching TXT record yet (DNS can take a few minutes).',
    token_mismatch: 'The file exists but does not contain this exact token.', token_not_in_head: 'No matching meta tag inside the page <head>.',
    blocked_address: 'This site resolves to a private or internal address, which Oddhound never scans.', https_required: 'Only HTTPS sites can be verified.',
    timeout: 'The site did not answer within 10 seconds.', response_too_large: 'The response was larger than 256 KB.',
  };
  const shown = result ?? (lastReason ? { verified, reason: lastReason } : null);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>{verified ? <span className="badge badge-ok"><Icon name="check" />Verified</span> : <span className="badge badge-warn"><Icon name="alert" />Not verified</span>}
        {lastChecked && <span className="muted" style={{ marginLeft: 8 }}>Last checked {new Date(lastChecked).toLocaleString()}. Oddhound re-checks before every run.</span>}</div>
      <div className="segmented" role="group" aria-label="Verification method">
        <button type="button" aria-pressed={method === 'well_known_file'} onClick={() => setMethod('well_known_file')}>File</button>
        <button type="button" aria-pressed={method === 'dns_txt'} onClick={() => setMethod('dns_txt')}>DNS TXT</button>
        <button type="button" aria-pressed={method === 'meta_tag'} onClick={() => setMethod('meta_tag')}>Meta tag</button>
      </div>
      {method === 'well_known_file' && <div className="field"><span>Serve this exact text at <code className="mono">{origin}/.well-known/oddhound-verify.txt</code> (HTTP 200, no redirect)</span><CopyField value={token} label="Verification file contents" /></div>}
      {method === 'dns_txt' && <div className="field"><span>Add a TXT record named <code className="mono">_oddhound-verify.{host}</code>. <strong>Warning:</strong> on DNS hosts that create the site's address records automatically (for example Vercel DNS), any new record at or under <code className="mono">{host}</code> can switch those off and take the site offline. Use the file or meta tag method there.</span><CopyField value={`oddhound-verify=${token}`} label="TXT record value" /></div>}
      {method === 'meta_tag' && <div className="field"><span>Add this tag inside the <code>&lt;head&gt;</code> of <code className="mono">{origin}/</code></span><CopyField value={`<meta name="oddhound-verification" content="${token}">`} label="Meta tag" /></div>}
      <div><button className="btn btn-primary" onClick={check} disabled={busy}><Icon name="shield" /> {busy ? 'Checking…' : 'Check now'}</button></div>
      {shown && <p role="status" style={{ margin: 0, color: shown.verified ? 'var(--ok)' : 'var(--bad)' }}>{reasons[shown.reason] ?? `Not verified (${shown.reason.replace(/_/g, ' ')}).`}</p>}
    </div>
  );
}
