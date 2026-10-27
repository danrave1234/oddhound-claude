import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { StatusBadge } from '@/ui/status';
import { currentUser, db } from '@/lib/server';
import { VerifyPanel } from './verify-panel';
import { RunSetup } from './run-setup';

export const dynamic = 'force-dynamic';

export default async function Project({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/app/projects/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const project = (await db().query('SELECT id, name, origin, environment, description FROM projects WHERE id = $1 AND owner_id = $2', [id, user.id])).rows[0];
  if (!project) notFound();
  const sv = (await db().query('SELECT token, method, verified, last_reason, last_checked_at FROM site_verifications WHERE project_id = $1 ORDER BY revision DESC LIMIT 1', [id])).rows[0];
  const runs = (await db().query(`SELECT id, mode, status, stop_reason, created_at, (SELECT count(*) FROM findings f WHERE f.run_id = r.id AND f.verification = 'verified' AND f.category = 'verified_issue')::int AS issues
    FROM runs r WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20`, [id])).rows;
  const host = new URL(project.origin).hostname;
  return (
    <Shell active="/app" user={user} toolbar={<><Link href="/app">Projects</Link><span className="muted">/</span><strong>{project.name}</strong><span className="mono muted">{project.origin}</span></>}>
      <section style={{ display: 'grid', gap: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Step 2 · Prove you own {host}</h2>
          <VerifyPanel projectId={id} origin={project.origin} token={sv.token} verified={sv.verified} lastReason={sv.last_reason} lastChecked={sv.last_checked_at ? new Date(sv.last_checked_at).toISOString() : null} />
        </div>
        <div className="card" style={{ padding: 20, opacity: sv.verified ? 1 : 0.6 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Step 3 · Approve what Oddhound may do</h2>
          {sv.verified ? <RunSetup projectId={id} environment={project.environment} /> : <p className="muted">Verify the site first. Unverified sites can never be scanned.</p>}
        </div>
        <div className="card">
          <div style={{ padding: '14px 16px' }} className="section-title">Runs</div>
          {runs.length ? (
            <table className="grid"><thead><tr><th>Started</th><th>Type</th><th>Status</th><th>Verified issues</th></tr></thead><tbody>
              {runs.map((r) => (
                <tr key={r.id}><td><Link href={`/runs/${r.id}`}>{new Date(r.created_at).toLocaleString()}</Link></td><td>{r.mode === 'retest' ? 'Retest' : 'Exploration'}</td>
                  <td><StatusBadge value={r.status} /> {r.stop_reason && <span className="muted">({String(r.stop_reason).replace(/_/g, ' ')})</span>}</td><td className="tabular">{r.issues}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted" style={{ padding: '0 16px 16px' }}>No runs yet.</p>}
        </div>
      </section>
    </Shell>
  );
}
