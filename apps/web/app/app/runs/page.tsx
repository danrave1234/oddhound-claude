import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { StatusBadge } from '@/ui/status';
import { currentUser, db } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Runs' };

export default async function Runs() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app/runs');
  const runs = (await db().query(`SELECT r.id, r.mode, r.status, r.stop_reason, r.origin, r.created_at, r.provider, p.name AS project,
      (SELECT count(*) FROM findings f WHERE f.run_id = r.id AND f.verification = 'verified' AND f.category = 'verified_issue')::int AS issues
    FROM runs r LEFT JOIN projects p ON p.id = r.project_id WHERE r.owner_id = $1 ${user.isAdmin ? "OR r.mode = 'demo_target'" : ''}
    ORDER BY r.created_at DESC LIMIT 100`, [user.id])).rows;
  return (
    <Shell active="/app/runs" user={user} toolbar={<strong>Runs</strong>}>
      <div className="card">
        <table className="grid"><thead><tr><th>Started</th><th>Project</th><th>Type</th><th>Status</th><th>Verified issues</th><th>Model</th></tr></thead><tbody>
          {runs.length ? runs.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/runs/${r.id}`}>{new Date(r.created_at).toLocaleString()}</Link></td>
              <td>{r.project ?? (r.mode === 'demo_target' ? 'Demo target' : '—')}</td>
              <td>{r.mode === 'retest' ? 'Retest' : r.mode === 'demo_target' ? 'Demo' : 'Exploration'}</td>
              <td><StatusBadge value={r.status} />{r.stop_reason && <span className="muted"> ({String(r.stop_reason).replace(/_/g, ' ')})</span>}</td>
              <td className="tabular">{r.issues}</td>
              <td className="muted">{r.provider === 'test-double' ? 'offline test double' : r.provider ?? '—'}</td>
            </tr>)) : <tr><td colSpan={6} className="muted">No runs yet.</td></tr>}
        </tbody></table>
      </div>
    </Shell>
  );
}
