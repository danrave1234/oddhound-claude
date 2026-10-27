'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';

export function TryDemoButton({ disabled, reason }: { disabled: boolean; reason: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true); setError(null);
    const res = await fetch('/api/demo/runs', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/runs/${body.runId}`);
    else { setError(body.error ?? 'Could not start a demo run.'); setBusy(false); }
  }
  return (
    <span style={{ display: 'inline-grid', gap: 4 }}>
      <button className="btn btn-lg" onClick={start} disabled={disabled || busy} aria-describedby="demo-msg">
        <Icon name="play" /> {busy ? 'Starting…' : 'Try the demo target'}
      </button>
      <span id="demo-msg" role="status" className="muted" style={{ fontSize: 12.5 }}>{error ?? (disabled ? reason : '')}</span>
    </span>
  );
}
