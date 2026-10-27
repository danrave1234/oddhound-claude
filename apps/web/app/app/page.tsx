import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RunsLeft, Shell } from '@/ui/shell';
import { HoundFigure, Icon } from '@/ui/icons';
import { currentUser, db, mayScanVerifiedSites } from '@/lib/server';
import { LIMITS } from '@core/contracts/limits.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects' };

export default async function Projects() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/app');
  const projects = (await db().query(`SELECT p.id, p.name, p.origin, p.environment,
      (SELECT verified FROM site_verifications sv WHERE sv.project_id = p.id AND sv.origin = p.origin ORDER BY revision DESC LIMIT 1) AS verified,
      (SELECT max(created_at) FROM runs r WHERE r.project_id = p.id) AS last_run
    FROM projects p WHERE p.owner_id = $1 ORDER BY p.created_at DESC`, [user.id])).rows;
  const today = (await db().query(`SELECT count(*)::int AS n FROM runs WHERE owner_id = $1 AND day_bucket = (now() AT TIME ZONE 'utc')::date AND counted_against_quota`, [user.id])).rows[0].n as number;
  const allowed = mayScanVerifiedSites(user);
  const left = Math.max(0, LIMITS.runsPerUserPerDay - today);
  return (
    <Shell active="/app" user={user} toolbar={<>
      <span className="toolbar-title">Projects</span>
      <span className="toolbar-spacer" />
      <RunsLeft left={left} total={LIMITS.runsPerUserPerDay} />
      {allowed && <Link className="btn btn-primary" href="/app/projects/new"><Icon name="plus" /> New project</Link>}
    </>}>
      <div className="page-head">
        <div>
          <h1 className="h1">Your sites</h1>
          <p className="lead">Each project is one origin you own. Verify it once; Oddhound re-checks ownership before every run.</p>
        </div>
      </div>

      {!allowed && (
        <div className="note note-info" role="note" style={{ marginBottom: 18 }}>
          <span className="note-icon"><Icon name="lock" /></span>
          <div>
            <strong>Verified-site scanning is invite-only for now.</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>It opens to everyone after Oddhound&apos;s public-launch safety checks pass. The demo target works today, no setup needed.</p>
            <div className="row" style={{ marginTop: 10 }}><Link className="btn btn-sm" href="/"><Icon name="eye" /> See the demo target and replay</Link></div>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="card empty">
          <div className="empty-art"><HoundFigure size={58} /></div>
          <h2 className="h2">No sites yet</h2>
          <p>Add a site you own, prove it with a file, DNS record or meta tag, and start your first run.</p>
          {allowed && <div className="actions"><Link className="btn btn-primary" href="/app/projects/new"><Icon name="plus" /> Add a site</Link></div>}
        </div>
      ) : (
        <div className="card list" role="list" aria-label="Projects">
          {projects.map((p) => (
            <Link key={p.id} role="listitem" className="list-row" href={`/app/projects/${p.id}`}>
              <span className={`tile${p.verified ? '' : ' tile-neutral'}`}><Icon name="globe" /></span>
              <span style={{ minWidth: 0 }}>
                <span className="title truncate" style={{ display: 'block' }}>{p.name}</span>
                <span className="meta">
                  <span className="mono truncate">{p.origin}</span>
                  <span className="chip">{p.environment === 'production' ? 'Production' : 'Staging'}</span>
                </span>
              </span>
              <span className="end">
                {p.verified ? <span className="badge badge-ok"><Icon name="check" />Verified</span> : <span className="badge badge-warn"><Icon name="alert" />Not verified</span>}
                <span className="muted tabular" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{p.last_run ? `Last run ${new Date(p.last_run).toLocaleDateString()}` : 'No runs yet'}</span>
                <span className="chev"><Icon name="chevron" /></span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
