import Link from 'next/link';
import { HoundMark, Icon } from '@/ui/icons';
import { publicStatus } from '@/lib/status-data';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Status' };

export default async function Status() {
  const s = await publicStatus();
  const lastBrowser = (await db().query(`SELECT sandbox_verdict, browser_ref, finished_at FROM runs WHERE sandbox_verdict IS NOT NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const row = (label: string, ok: boolean, detail: string) => (
    <tr><td>{label}</td><td>{ok ? <span className="badge badge-ok"><Icon name="check" />OK</span> : <span className="badge badge-warn"><Icon name="alert" />Attention</span>}</td><td className="muted">{detail}</td></tr>
  );
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px' }}>
      <Link href="/" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--text)', fontWeight: 700 }}><HoundMark /> Oddhound</Link>
      <h1 style={{ fontSize: 24 }}>Service status</h1>
      <div className="card">
        <table className="grid"><tbody>
          {row('Live runs', !s.killSwitch, s.killSwitch ? 'Paused by the operator (kill switch on).' : 'Accepting runs.')}
          {row('Meta model access', s.metaConfigured, s.metaConfigured ? 'Primary profile: Meta muse-spark-1.3 (direct API).' : 'No Meta API key configured; live runs are blocked.')}
          {row('Public budget today', s.publicDailyLeftUsd > 0.5, `$${s.publicDailyLeftUsd.toFixed(2)} of $7.00 left today (UTC); $${s.publicLifetimeLeftUsd.toFixed(2)} of $50.00 lifetime.`)}
          {row('Queue', s.queued < 20, `${s.active} active, ${s.queued} waiting (limit 20).`)}
          {row('Browser isolation', lastBrowser?.sandbox_verdict === 'sandbox_on', lastBrowser ? `Last run: ${lastBrowser.browser_ref}, Chromium sandbox ${lastBrowser.sandbox_verdict}.` : 'No run yet.')}
          {row('Demo replay', Boolean(s.replayRunId), s.replayRunId ? 'A recorded real run is available.' : 'No recorded run yet.')}
        </tbody></table>
      </div>
      <p className="muted">Oddhound only scans origins whose owners have verified them, plus its own demo target. Private and internal addresses are always refused.</p>
    </main>
  );
}
