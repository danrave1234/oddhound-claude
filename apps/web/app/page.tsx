import Link from 'next/link';
import { HoundMark, Icon } from '@/ui/icons';
import { publicStatus } from '@/lib/status-data';
import { currentUser } from '@/lib/server';
import { TryDemoButton } from './try-demo-button';

export const dynamic = 'force-dynamic';

export default async function Landing() {
  const [status, user] = await Promise.all([publicStatus(), currentUser()]);
  return (
    <div>
      <header className="toolbar" style={{ justifyContent: 'space-between' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 700 }}>
          <HoundMark size={26} /> Oddhound
        </Link>
        <nav style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" href="/status">Status</Link>
          {user ? <Link className="btn" href="/app">Open workspace</Link> : <Link className="btn" href="/login">Sign in</Link>}
        </nav>
      </header>
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '56px 24px' }}>
        <p className="section-title">Exploratory testing agent · Meta Muse Spark</p>
        <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: '8px 0 16px', letterSpacing: '-0.02em' }}>Find what you didn&apos;t test.</h1>
        <p style={{ fontSize: 18, color: 'var(--text-2)', maxWidth: 680 }}>
          Oddhound explores your web app in a real, isolated browser. It signs up, books, edits and cancels like a curious user,
          tries the unexpected inputs and orderings people actually use, and turns what breaks into evidence you can hand to your coding AI.
          After you fix it, Oddhound replays the exact same check.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
          <Link className="btn btn-primary btn-lg" href={user ? '/app/projects/new' : '/login?next=/app/projects/new'}><Icon name="globe" /> Scan your site</Link>
          <TryDemoButton disabled={!status.liveRunsAvailable || !status.demoConfigured} reason={status.killSwitch ? 'Live runs are paused.' : !status.liveRunsAvailable ? 'Today\'s public budget is used up.' : null} />
          {status.replayRunId
            ? <Link className="btn btn-lg" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>
            : <span className="btn btn-lg" aria-disabled="true" title="No recorded run yet">No replay recorded yet</span>}
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          The demo target is Oddhound&apos;s own booking app with labelled defects. No sign-in needed. Live runs are limited and shared;
          {status.liveRunsAvailable ? ` about $${status.publicDailyLeftUsd.toFixed(2)} of today's public budget remains.` : ' the replay is always available.'}
        </p>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 56 }}>
          {[
            ['shield', 'Only sites you own', 'Prove control with a DNS record, a /.well-known file or a meta tag. Oddhound re-checks it before every run and never touches private networks.'],
            ['workflow', 'Real exploration, no scripts', 'Give goals and rules, not click paths. The agent discovers sign-up, login and your workflows, then tries boundary values, blank input, a second account and a phone screen.'],
            ['check', 'Verified, not guessed', 'Every candidate is replayed twice in fresh sessions with a valid neighbouring case. Configuration observations and suggestions are kept separate from defects.'],
            ['retest', 'Fix, then retest unchanged', 'Copy a fix brief into your coding AI. Retest replays the saved assertion — no healing, no weakened checks.'],
          ].map(([icon, title, body]) => (
            <div className="card" key={title} style={{ padding: 18 }}>
              <div style={{ color: 'var(--accent)' }}><Icon name={icon as 'shield'} size={24} /></div>
              <h3 style={{ margin: '10px 0 6px', fontSize: 16 }}>{title}</h3>
              <p className="muted" style={{ margin: 0 }}>{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
