import Link from 'next/link';
import { HoundMark, Icon, type IconName } from '@/ui/icons';
import { publicStatus } from '@/lib/status-data';
import { currentUser } from '@/lib/server';
import { TryDemoButton } from './try-demo-button';
import { HeroDemo } from './hero-demo';

export const dynamic = 'force-dynamic';

const STEPS: { title: string; detail: string }[] = [
  { title: 'Prove you own the site', detail: 'Add a DNS record, a /.well-known file or a meta tag. Oddhound checks it again before every run.' },
  { title: 'Let the hound explore', detail: 'A fresh, sandboxed browser signs up, edits and cancels the way a curious user would.' },
  { title: 'Get replayed evidence', detail: 'Each suspect is re-run in a clean session. Only a broken rule with saved proof counts.' },
  { title: 'Fix it and retest', detail: 'Paste the fix prompt into your coding AI. Retest runs the same check, unchanged.' },
];

// Kinds of unexpected input and ordering the agent is allowed to try (run contract, MVP §17).
const ODD = ['A party size of 0', 'A name made of spaces', 'One character over the limit', 'A second account', 'A 390px phone', 'Double submit',
  'Back button mid-checkout', 'Cancel, then edit', 'A date in the past', 'Emoji in names', 'Required fields left empty', 'Someone else’s record ID'];

const PROOF: { icon: IconName; title: string; body: string }[] = [
  { icon: 'shield', title: 'Only sites you own', body: 'No verified ownership, no run. Private and internal addresses are refused even when a verified name points at them.' },
  { icon: 'replay', title: 'Verified, not guessed', body: 'A candidate becomes an issue only when fresh replays break one of your rules and a valid case still passes.' },
  { icon: 'retest', title: 'The same check after your fix', body: 'Retest replays the saved assertion. Nothing heals itself into a pass, and “no failures” means none in the tested scope.' },
];

export default async function Landing() {
  const [status, user] = await Promise.all([publicStatus(), currentUser()]);
  const demoReason = status.killSwitch ? 'Live runs are paused right now.' : !status.liveRunsAvailable ? 'Today’s public budget is used up.' : !status.demoConfigured ? 'The demo target is not configured on this deployment.' : null;
  const scanHref = user ? '/app/projects/new' : '/login?next=/app/projects/new';
  return (
    <div className="landing">
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link href="/" className="brand"><HoundMark size={28} /> Oddhound</Link>
          <nav aria-label="Site">
            <Link className="btn btn-ghost hide-sm" href="#how">How it works</Link>
            <Link className="btn btn-ghost" href="/status">Status</Link>
            {user ? <Link className="btn" href="/app">Open workspace</Link> : <Link className="btn" href="/login"><Icon name="signin" /> Sign in</Link>}
          </nav>
        </div>
      </header>

      <main>
        <section className="wrap hero3" aria-labelledby="hero-title">
          <div className="hero3-grid">
            <div className="hero3-copy">
              <h1 id="hero-title" className="hero3-title">Find what you didn&apos;t test.</h1>
              <p className="lead">
                Oddhound is an AI tester running on Meta Muse Spark. It explores your web app in a real, isolated browser, signs up, books,
                edits and cancels like a curious user, tries the odd things people actually do, and proves what breaks with replayed evidence.
              </p>
              <div className="hero-ctas">
                <Link className="btn btn-primary btn-lg" href={scanHref}><Icon name="sniff" /> Scan your site</Link>
                <TryDemoButton disabled={Boolean(demoReason)} reason={demoReason} />
                {status.replayRunId
                  ? <Link className="btn btn-ghost btn-lg" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>
                  : <span className="btn btn-ghost btn-lg" aria-disabled="true" title="No recorded run yet"><Icon name="eye" /> No replay recorded yet</span>}
              </div>
              <p className="hero-note">
                <Icon name="info" />
                <span>The demo target is Oddhound&apos;s own booking app with labelled defects. No account needed.
                  {status.liveRunsAvailable ? <> About <strong className="tabular" style={{ color: 'var(--text-2)' }}>${status.publicDailyLeftUsd.toFixed(2)}</strong> of today&apos;s shared budget is left.</> : ' The replay is always available.'}</span>
              </p>
            </div>
            <HeroDemo />
          </div>
        </section>

        <section className="wrap odd2" aria-labelledby="odd-title">
          <h2 id="odd-title" className="h2">What the hound tries that test scripts forget</h2>
          <ul className="odd2-list">{ODD.map((o) => <li key={o}>{o}</li>)}</ul>
        </section>

        <section id="how" className="wrap how2" aria-labelledby="how-title">
          <h2 id="how-title" className="sec-title">How a run works</h2>
          <ol className="how2-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="how2-n" aria-hidden>{i + 1}</span>
                <h3 className="h2">{s.title}</h3>
                <p>{s.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="wrap proof" aria-labelledby="proof-title">
          <div className="proof-intro">
            <h2 id="proof-title" className="sec-title">Evidence first. Nothing invented.</h2>
            <p className="lead">Every finding points to a rule you wrote and to proof from an independent replay. What wasn&apos;t tested is said plainly.</p>
          </div>
          <div className="proof-grid">
            <article className="proof-feature" aria-label="Illustration of ownership proof and independent replays">
              <div className="viz-own" aria-hidden>
                <div className="vo-tabs"><span className="on">File</span><span>Meta tag</span><span>DNS TXT</span></div>
                <div className="vo-code"><span className="muted">/.well-known/oddhound-verify.txt</span><span className="vo-type">oh_3f9a2c71e8…</span></div>
                <span className="badge badge-ok vo-badge"><Icon name="check" />Verified</span>
              </div>
              <div className="viz-rep" aria-hidden>
                <div className="vr-lane"><span>Replay 1</span><i className="vr-bar" /><Icon name="fail" /></div>
                <div className="vr-lane"><span>Replay 2</span><i className="vr-bar" /><Icon name="fail" /></div>
                <div className="vr-lane ok"><span>Valid case</span><i className="vr-bar" /><Icon name="check" /></div>
              </div>
            </article>
            <ul className="proof-list">
              {PROOF.map((p) => (
                <li key={p.title}><span className="proof-icon"><Icon name={p.icon} /></span><div><h3 className="h3">{p.title}</h3><p>{p.body}</p></div></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="wrap">
          <div className="cta-band">
            <div className="cta-copy">
              <h2 className="sec-title">Point the hound at your site.</h2>
              <p>Verify it, approve what it may do, and watch it work. Or start with the demo, no account needed.</p>
              <div className="row" style={{ gap: 10, marginTop: 8 }}>
                <Link className="btn btn-lg cta-solid" href={scanHref}><Icon name="sniff" /> Scan your site</Link>
                {status.replayRunId && <Link className="btn btn-lg cta-ghost" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>}
              </div>
            </div>
            <span className="cta-mark hide-sm"><HoundMark size={112} /></span>
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div className="wrap">
          <span className="brand" style={{ fontSize: 13.5 }}><HoundMark size={20} /> Oddhound</span>
          <span className="row" style={{ gap: 16 }}>
            <Link href="/status">Service status</Link>
            {user ? <Link href="/app">Workspace</Link> : <Link href="/login">Sign in</Link>}
          </span>
        </div>
      </footer>
    </div>
  );
}
