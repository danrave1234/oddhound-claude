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
    <Shell active="/app/reports" user={user} toolbar={<strong>Reports</strong>}>
      <p className="muted" style={{ marginTop: 0 }}>Fix briefs and exported regression tests for verified issues. Briefs are built only from saved evidence; page text is marked untrusted.</p>
      <div className="card">
        <table className="grid"><thead><tr><th>Finding</th><th>Status</th><th>Project</th><th>Fix brief</th><th>Regression test</th></tr></thead><tbody>
          {rows.length ? rows.map((f) => (
            <tr key={f.id}><td><Link href={`/runs/${f.run_id}`}>{f.title}</Link></td><td><StatusBadge value={f.lifecycle} /></td><td>{f.project ?? '—'}</td>
              <td><a href={`/api/findings/${f.id}/brief`}><Icon name="report" /> Markdown</a> · <a href={`/api/findings/${f.id}/brief?format=json`}>JSON</a></td>
              <td><a href={`/api/findings/${f.id}/export`}><Icon name="download" /> .spec.ts</a></td></tr>
          )) : <tr><td colSpan={5} className="muted">No verified issues yet.</td></tr>}
        </tbody></table>
      </div>
    </Shell>
  );
}
