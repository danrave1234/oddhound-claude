'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/ui/icons';

/** Quick-start tile that starts a demo-target run (same endpoint and limits as the landing button). */
export function QuickDemoTile({ disabledReason }: { disabledReason: string | null }) {
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
  const note = error ?? disabledReason;
  return (
    <button type="button" className="quick-tile" onClick={start} disabled={Boolean(disabledReason) || busy} aria-busy={busy || undefined} style={{ font: 'inherit', textAlign: 'left', cursor: disabledReason ? 'not-allowed' : 'pointer', opacity: disabledReason ? 0.7 : 1 }}>
      <span className="tile"><Icon name="play" /></span>
      <span className="qt-body"><strong>{busy ? 'Starting a fresh browser…' : 'Try the demo target'}</strong>
        <span role="status" style={error ? { color: 'var(--bad)' } : undefined}>{note ?? 'Oddhound’s own app with labelled defects'}</span></span>
    </button>
  );
}
