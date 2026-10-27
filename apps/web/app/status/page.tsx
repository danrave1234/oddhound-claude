import Link from 'next/link';
import { HoundMark, Icon, type IconName } from '@/ui/icons';
import { publicStatus } from '@/lib/status-data';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Status' };

export default async function Status() {
  const s = await publicStatus();
  const lastBrowser = (await db().query(`SELECT sandbox_verdict, browser_ref, finished_at FROM runs WHERE sandbox_verdict IS NOT NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const rows: { icon: IconName; label: string; ok: boolean; detail: string }[] = [
    { icon: 'play', label: 'Live runs', ok: !s.killSwitch, detail: s.killSwitch ? 'Paused by the operator (kill switch on).' : 'Accepting runs.' },
    { icon: 'sniff', label: 'Meta model access', ok: s.metaConfigured, detail: s.metaConfigured ? 'Primary profile: Meta muse-spark-1.3 (direct API).' : 'No Meta API key configured; live runs are blocked.' },
    { icon: 'pulse', label: 'Public budget today', ok: s.publicDailyLeftUsd > 0.5, detail: `$${s.publicDailyLeftUsd.toFixed(2)} of $7.00 left today (UTC); $${s.publicLifetimeLeftUsd.toFixed(2)} of $50.00 lifetime.` },
    { icon: 'list', label: 'Queue', ok: s.queued < 20, detail: `${s.active} active, ${s.queued} waiting (limit 20).` },
    { icon: 'shield', label: 'Browser isolation', ok: lastBrowser?.sandbox_verdict === 'sandbox_on', detail: lastBrowser ? `Last run: ${lastBrowser.browser_ref}, Chromium sandbox ${lastBrowser.sandbox_verdict}.` : 'No run yet.' },
    { icon: 'eye', label: 'Demo replay', ok: Boolean(s.replayRunId), detail: s.replayRunId ? 'A recorded real run is available.' : 'No recorded run yet.' },
  ];
  const attention = rows.filter((r) => !r.ok).length;
  return (
    <div>
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand"><HoundMark size={28} /> Oddhound</Link>
          <nav aria-label="Site"><Link className="btn btn-ghost" href="/">Home</Link></nav>
        </div>
      </header>
      <main className="wrap fade-in" style={{ maxWidth: 820, paddingTop: 40, paddingBottom: 56 }}>
        <div className="page-head">
          <div>
            <h1 className="h1">Service status</h1>
            <p className="lead">Checked when this page loaded ({new Date().toLocaleTimeString()}). Refresh for current values.</p>
          </div>
          {attention === 0
            ? <span className="badge badge-ok" style={{ height: 28, padding: '0 12px 0 9px', fontSize: 13 }}><Icon name="check" />All systems normal</span>
            : <span className="badge badge-warn" style={{ height: 28, padding: '0 12px 0 9px', fontSize: 13 }}><Icon name="alert" />{attention} need{attention === 1 ? 's' : ''} attention</span>}
        </div>
        <div className="card list">
          {rows.map((r) => (
            <div className="list-row" key={r.label}>
              <span className={`tile${r.ok ? ' tile-neutral' : ''}`} style={r.ok ? undefined : { background: 'var(--warn-soft)', color: 'var(--warn)' }}><Icon name={r.icon} /></span>
              <span style={{ minWidth: 0 }}><span className="title" style={{ display: 'block' }}>{r.label}</span><span className="meta break">{r.detail}</span></span>
              <span className="end">{r.ok ? <span className="badge badge-ok"><Icon name="check" />OK</span> : <span className="badge badge-warn"><Icon name="alert" />Attention</span>}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: 13, display: 'flex', gap: 8 }}><Icon name="shield" /> Oddhound only scans origins whose owners have verified them, plus its own demo target. Private and internal addresses are always refused.</p>
      </main>
    </div>
  );
}
