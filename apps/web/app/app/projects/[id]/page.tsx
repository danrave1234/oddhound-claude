import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/ui/shell';
import { StatusBadge } from '@/ui/status';
import { Icon } from '@/ui/icons';
import { SetupSteps } from '@/ui/setup-steps';
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
    <Shell active="/app" user={user} toolbar={<div className="crumbs"><Link href="/app">Projects</Link><span className="muted">/</span><strong className="truncate">{project.name}</strong></div>}>
      <div className="stack" style={{ maxWidth: 860 }}>
        <div>
          <SetupSteps current={sv.verified ? 3 : 2} />
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div style={{ minWidth: 0 }}>
              <h1 className="h1 break">{project.name}</h1>
              <p className="row" style={{ marginTop: 8, gap: 8 }}>
                <span className="mono muted break">{project.origin}</span>
                <span className="chip">{project.environment === 'production' ? 'Production' : 'Staging'}</span>
              </p>
            </div>
          </div>
        </div>

        <section className="card card-pad" aria-labelledby="verify-h">
          <div className="step-card-head" style={{ marginBottom: 16 }}>
            <span className={`step-num${sv.verified ? ' done' : ''}`} aria-hidden>{sv.verified ? <Icon name="tick" /> : 2}</span>
            <div style={{ minWidth: 0 }}>
              <h2 id="verify-h" className="h2 break">Prove you own {host}</h2>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>Pick one method, publish the value, then check. Unverified sites can never be scanned.</p>
            </div>
          </div>
          <VerifyPanel projectId={id} origin={project.origin} token={sv.token} verified={sv.verified} lastReason={sv.last_reason} lastChecked={sv.last_checked_at ? new Date(sv.last_checked_at).toISOString() : null} />
        </section>

        <section className="card card-pad" aria-labelledby="setup-h" aria-disabled={!sv.verified || undefined}>
          <div className="step-card-head" style={{ marginBottom: sv.verified ? 18 : 0 }}>
            <span className={`step-num${sv.verified ? '' : ' locked'}`} aria-hidden>{sv.verified ? 3 : <Icon name="lock" />}</span>
            <div>
              <h2 id="setup-h" className="h2">Approve what Oddhound may do</h2>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>{sv.verified ? 'Safe defaults are filled in. Adjust anything, then start the run.' : 'Unlocks once the site is verified.'}</p>
            </div>
          </div>
          {sv.verified && <RunSetup projectId={id} environment={project.environment} />}
        </section>

        <section className="card" aria-labelledby="runs-h">
          <div className="card-header"><h2 id="runs-h" className="h3"><Icon name="runs" /> Runs</h2><span className="muted tabular" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{runs.length ? `${runs.length} most recent` : ''}</span></div>
          {runs.length ? (
            <div className="table-wrap">
              <table className="grid"><thead><tr><th>Started</th><th>Type</th><th>Status</th><th>Verified issues</th></tr></thead><tbody>
                {runs.map((r) => (
                  <tr key={r.id}><td><Link href={`/runs/${r.id}`} className="tabular">{new Date(r.created_at).toLocaleString()}</Link></td><td>{r.mode === 'retest' ? 'Retest' : 'Exploration'}</td>
                    <td><span className="row" style={{ gap: 6 }}><StatusBadge value={r.status} />{r.stop_reason && <span className="muted" style={{ fontSize: 12.5 }}>{String(r.stop_reason).replace(/_/g, ' ')}</span>}</span></td>
                    <td className="tabular">{r.issues}</td></tr>
                ))}
              </tbody></table>
            </div>
          ) : <div className="empty empty-sm"><p>No runs yet. Your first run will appear here.</p></div>}
        </section>
      </div>
    </Shell>
  );
}
