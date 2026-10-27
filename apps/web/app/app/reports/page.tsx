import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { StatusBadge } from '@/ui/status';
import { Icon } from '@/ui/icons';
import { currentUser, db } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

export default async function Reports() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app/reports');
  const rows = (await db().query(`SELECT f.id, f.run_id, f.title, f.lifecycle, f.updated_at, p.name AS project
    FROM findings f JOIN runs r ON r.id = f.run_id LEFT JOIN projects p ON p.id = r.project_id
    WHERE r.owner_id = $1 AND f.category = 'verified_issue' AND f.verification = 'verified' ORDER BY f.updated_at DESC LIMIT 200`, [user.id])).rows;
  return (
    <Shell active="/app/reports" user={user} toolbar={<span className="toolbar-title">Reports</span>}>
      <div className="page-head"><div><h1 className="h1">Reports</h1><p className="lead">Fix briefs and exported regression tests for verified issues. Briefs are built only from saved evidence; page text is marked untrusted.</p></div></div>
      <div className="card"><div className="table-wrap">
        <table className="grid"><thead><tr><th>Finding</th><th>Status</th><th>Project</th><th>Fix brief</th><th>Regression test</th></tr></thead><tbody>
          {rows.length ? rows.map((f) => (
            <tr key={f.id}><td><Link href={`/runs/${f.run_id}`}>{f.title}</Link></td><td><StatusBadge value={f.lifecycle} /></td><td>{f.project ?? '—'}</td>
              <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><a className="btn btn-sm" href={`/api/findings/${f.id}/brief`}><Icon name="brief" /> Markdown</a><a className="btn btn-sm btn-ghost" href={`/api/findings/${f.id}/brief?format=json`}>JSON</a></span></td>
              <td><a className="btn btn-sm" href={`/api/findings/${f.id}/export`}><Icon name="download" /> .spec.ts</a></td></tr>
          )) : <tr><td colSpan={5} className="empty-cell">No verified issues yet. When a run verifies one, its fix brief and test appear here.</td></tr>}
        </tbody></table>
      </div></div>
    </Shell>
  );
}
