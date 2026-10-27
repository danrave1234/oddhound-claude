import Link from 'next/link';
import { HoundFigure, HoundMark, Icon, type IconName } from '@/ui/icons';
import { publicStatus } from '@/lib/status-data';
import { currentUser } from '@/lib/server';
import { TryDemoButton } from './try-demo-button';

export const dynamic = 'force-dynamic';

const STEPS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'shield', title: 'Prove you own the site', detail: 'A DNS record, a /.well-known file or a meta tag. Re-checked before every run.' },
  { icon: 'sniff', title: 'The agent explores', detail: 'A fresh, sandboxed browser signs up, edits and cancels like a curious user.' },
  { icon: 'replay', title: 'Suspects are replayed', detail: 'Each candidate is re-run independently before it is called verified.' },
  { icon: 'brief', title: 'Fix, then retest unchanged', detail: 'Copy the fix prompt into your coding AI. Retest replays the same check.' },
];

const PRINCIPLES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'shield', title: 'Only sites you own', body: 'Oddhound scans an origin only after you prove control of it, and re-checks that proof at the start of every run. Private and internal addresses are always refused.' },
  { icon: 'trail', title: 'Goals and rules, not click scripts', body: 'You describe what the site should do. The agent discovers sign-up, login and your workflows on its own, then tries boundary values, blank input, a second account and a phone screen.' },
  { icon: 'replay', title: 'Verified, not guessed', body: 'A candidate becomes a verified issue only when independent replays in fresh sessions break one of your rules. Configuration observations and suggestions are kept apart from defects.' },
  { icon: 'retest', title: 'The same check after your fix', body: 'Retest replays the saved assertion exactly. No auto-healing, no weakened checks, and “no failures” always means none within the tested scope.' },
];

export default async function Landing() {
  const [status, user] = await Promise.all([publicStatus(), currentUser()]);
  const demoReason = status.killSwitch ? 'Live runs are paused right now.' : !status.liveRunsAvailable ? 'Today’s public budget is used up.' : !status.demoConfigured ? 'The demo target is not configured on this deployment.' : null;
  return (
    <div className="landing">
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand"><HoundMark size={28} /> Oddhound</Link>
          <nav aria-label="Site">
            <Link className="btn btn-ghost" href="/status">Status</Link>
            {user ? <Link className="btn" href="/app">Open workspace <Icon name="arrow" /></Link> : <Link className="btn" href="/login"><Icon name="signin" /> Sign in</Link>}
          </nav>
        </div>
      </header>

      <main>
        <section className="wrap hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="kicker rise-in"><span className="rule" aria-hidden /> Exploratory testing agent · Meta Muse Spark</p>
            <h1 id="hero-title" className="display rise-in d1">
              Find what you{' '}
              <span className="underline-word">didn&apos;t
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden><path d="M2 7.5c18-4 40-5.5 62-4 12 .8 22 2 34 3.6" /></svg>
              </span>{' '}test.
            </h1>
            <p className="lead rise-in d2">
              Oddhound explores your web app in a real, isolated browser. It signs up, books, edits and cancels like a curious user,
              tries the odd inputs and orderings people actually use, and turns what breaks into evidence you can hand to your coding AI.
            </p>
            <div className="hero-ctas rise-in d3">
              <Link className="btn btn-primary btn-lg" href={user ? '/app/projects/new' : '/login?next=/app/projects/new'}><Icon name="sniff" /> Scan your site</Link>
              <TryDemoButton disabled={Boolean(demoReason)} reason={demoReason} />
              {status.replayRunId
                ? <Link className="btn btn-ghost btn-lg" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>
                : <span className="btn btn-ghost btn-lg" aria-disabled="true" title="No recorded run yet"><Icon name="eye" /> No replay recorded yet</span>}
            </div>
            <p className="hero-note rise-in d3">
              <Icon name="info" />
              <span>The demo target is Oddhound&apos;s own booking app with labelled defects — no sign-in needed. Live runs are limited and shared;
                {status.liveRunsAvailable ? <> about <strong className="tabular" style={{ color: 'var(--text-2)' }}>${status.publicDailyLeftUsd.toFixed(2)}</strong> of today&apos;s public budget remains.</> : ' the replay is always available.'}</span>
            </p>
          </div>

          <div className="hero-visual rise-in d2">
            <HoundFigure size={136} />
            <div className="loop">
              <div className="loop-head">
                <Icon name="paw" />
                <strong className="h3">How a run works</strong>
                <span className="chip" style={{ marginLeft: 'auto' }}>4 steps</span>
              </div>
              <ol>
                {STEPS.map((s, i) => (
                  <li key={s.title}>
                    <span className="tile"><Icon name={s.icon} /></span>
                    <div>
                      <div className="step-t"><span className="num">0{i + 1}</span>{s.title}</div>
                      <div className="step-d">{s.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="wrap principles" aria-labelledby="principles-title">
          <div className="principles-intro">
            <p className="kicker"><span className="rule" aria-hidden /> Why teams trust the results</p>
            <h2 id="principles-title" className="h1">Evidence first. Nothing invented.</h2>
            <p className="lead" style={{ fontSize: 15.5 }}>Every finding is tied to a rule you wrote and to saved evidence from an independent replay. What wasn&apos;t tested is said plainly.</p>
          </div>
          <ul className="principle-list">
            {PRINCIPLES.map((p) => (
              <li className="principle" key={p.title}>
                <span className="p-icon"><Icon name={p.icon} size={24} /></span>
                <div className="p-body"><h3 className="h2">{p.title}</h3><p>{p.body}</p></div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="site-foot">
        <div className="wrap">
          <span className="brand" style={{ fontSize: 13.5 }}><HoundMark size={20} /> Oddhound — Find what you didn&apos;t test.</span>
          <span className="row" style={{ gap: 16 }}>
            <Link href="/status">Service status</Link>
            {user ? <Link href="/app">Workspace</Link> : <Link href="/login">Sign in</Link>}
          </span>
        </div>
      </footer>
    </div>
  );
}
