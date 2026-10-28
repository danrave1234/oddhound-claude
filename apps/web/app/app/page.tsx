import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RunsLeft, Shell } from '@/ui/shell';
import { HoundArt, Icon } from '@/ui/icons';
import { currentUser, db, mayScanVerifiedSites } from '@/lib/server';
import { publicStatus } from '@/lib/status-data';
import { QuickDemoTile } from './quick-demo';
import { LIMITS } from '@core/contracts/limits.ts';

export const dynamic = 'force-dynamic';

const TINTS = ['#a33b17', '#3f46a3', '#1d6b3a', '#0f6672', '#7a3a8c', '#8a5a00'];
const tint = (name: string) => TINTS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];
const monogram = (name: string) => (name.replace(/^https?:\/\//, '').match(/[A-Za-z0-9]/g) ?? ['?']).slice(0, 2).join('').toUpperCase();
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
  const status = await publicStatus();
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

      <div className="quick">
        {allowed
          ? <Link className="quick-tile primary" href="/app/projects/new"><span className="tile"><Icon name="plus" /></span><span className="qt-body"><strong>Add a site</strong><span>Verify it, then start a run</span></span></Link>
          : <div className="quick-tile"><span className="tile tile-neutral"><Icon name="lock" /></span><span className="qt-body"><strong>Verified sites: invite-only</strong><span>Opens after launch safety checks pass</span></span></div>}
        <QuickDemoTile disabledReason={status.killSwitch ? 'Live runs are paused right now.' : !status.liveRunsAvailable ? 'Today’s public budget is used up.' : !status.demoConfigured ? 'The demo target is not configured here.' : null} />
        {status.replayRunId
          ? <Link className="quick-tile" href={`/runs/${status.replayRunId}?replay=1`}><span className="tile"><Icon name="eye" /></span><span className="qt-body"><strong>Watch a demo replay</strong><span>A recorded real run, played back</span></span></Link>
          : <div className="quick-tile"><span className="tile tile-neutral"><Icon name="eye" /></span><span className="qt-body"><strong>No replay yet</strong><span>A recorded run will appear here</span></span></div>}
      </div>

      {projects.length === 0 ? (
        <div className="card empty">
          <div className="empty-illo" aria-hidden><HoundArt name="tracking" width={340} /></div>
          <h2 className="h2">No sites yet</h2>
          <p>Add a site you own, prove it with a file, DNS record or meta tag, and start your first run.</p>
          {allowed && <div className="actions"><Link className="btn btn-primary" href="/app/projects/new"><Icon name="plus" /> Add a site</Link></div>}
        </div>
      ) : (
        <div className="proj-grid" role="list" aria-label="Projects">
          {projects.map((p, i) => (
            <Link key={p.id} role="listitem" className="proj-card" href={`/app/projects/${p.id}`}>
                <span className="proj-head">
                  <span className="monogram" style={{ background: tint(p.name) }} aria-hidden>{monogram(p.name)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="h3 truncate" style={{ display: 'block' }}>{p.name}</span>
                    <span className="mono muted truncate" style={{ display: 'block', fontSize: 12 }}>{p.origin}</span>
                  </span>
                  <span className="chev"><Icon name="chevron" /></span>
                </span>
                <span className="proj-meta">
                  {p.verified ? <span className="badge badge-ok"><Icon name="check" />Verified</span> : <span className="badge badge-warn"><Icon name="alert" />Not verified</span>}
                  <span className="chip">{p.environment === 'production' ? 'Production' : 'Staging'}</span>
                </span>
                <span className="proj-foot">
                  <span className="row" style={{ gap: 6 }}><Icon name="clock" />{p.last_run ? `Last run ${new Date(p.last_run).toLocaleDateString()}` : 'No runs yet'}</span>
                  <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{p.verified ? 'Start a run' : 'Verify'}</span>
                </span>
              </Link>
          ))}
          {allowed && <Link className="proj-card proj-add" href="/app/projects/new"><span className="tile"><Icon name="plus" /></span><strong>Add another site</strong></Link>}
        </div>
      )}
    </Shell>
  );
}
