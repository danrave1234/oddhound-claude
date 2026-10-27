import Link from 'next/link';
import { HoundFigure, HoundMark, Icon, type IconName } from '@/ui/icons';
import { Reveal } from '@/ui/motion';
import { publicStatus } from '@/lib/status-data';
import { currentUser } from '@/lib/server';
import { TryDemoButton } from './try-demo-button';
import { HeroDemo } from './hero-demo';

export const dynamic = 'force-dynamic';

const STEPS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'shield', title: 'Prove you own it', detail: 'A DNS record, a /.well-known file or a meta tag. Re-checked before every run.' },
  { icon: 'sniff', title: 'The hound explores', detail: 'A fresh, sandboxed browser signs up, edits and cancels like a curious user.' },
  { icon: 'replay', title: 'Suspects are replayed', detail: 'Each candidate is re-run independently before it is called verified.' },
  { icon: 'brief', title: 'Fix, then retest', detail: 'Paste the fix prompt into your coding AI. Retest replays the same check.' },
];

// Kinds of unexpected input and ordering the agent is allowed to try (run contract, MVP §17).
const ODD = ['party size 0', 'a name of only spaces', 'max length + 1', 'a second account', 'a 390px phone screen', 'double submit', 'back button mid-flow',
  'cancel, then edit', 'past dates', 'emoji in names', 'empty required fields', 'someone else’s record ID'];

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
            {user ? <Link className="btn" href="/app">Open workspace <Icon name="arrow" /></Link> : <Link className="btn" href="/login"><Icon name="signin" /> Sign in</Link>}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="wrap hero hero-v2" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="kicker rise-in"><span className="rule" aria-hidden /> Exploratory testing agent · Meta Muse Spark</p>
            <h1 id="hero-title" className="display rise-in d1">
              Find what you{' '}
              <span className="underline-word">didn&apos;t
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden><path d="M2 7.5c18-4 40-5.5 62-4 12 .8 22 2 34 3.6" /></svg>
              </span>{' '}test.
            </h1>
            <p className="lead rise-in d2">
              Oddhound sends an AI hound through your web app in a real, isolated browser. It signs up, books, edits and cancels like a
              curious user, tries the odd things people actually do, and proves what breaks with replayed evidence.
            </p>
            <div className="hero-ctas rise-in d3">
              <Link className="btn btn-primary btn-lg" href={scanHref}><Icon name="sniff" /> Scan your site</Link>
              <TryDemoButton disabled={Boolean(demoReason)} reason={demoReason} />
              {status.replayRunId
                ? <Link className="btn btn-ghost btn-lg" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>
                : <span className="btn btn-ghost btn-lg" aria-disabled="true" title="No recorded run yet"><Icon name="eye" /> No replay recorded yet</span>}
            </div>
            <p className="hero-note rise-in d3">
              <Icon name="info" />
              <span>The demo target is Oddhound&apos;s own booking app with labelled defects — no sign-in needed.
                {status.liveRunsAvailable ? <> About <strong className="tabular" style={{ color: 'var(--text-2)' }}>${status.publicDailyLeftUsd.toFixed(2)}</strong> of today&apos;s shared budget remains.</> : ' The replay is always available.'}</span>
            </p>
          </div>
          <div className="hero-visual rise-in d2">
            <HoundFigure size={120} />
            <HeroDemo />
          </div>
        </section>

        {/* Odd inputs marquee */}
        <section className="odd" aria-label="Unexpected things the hound tries">
          <div className="odd-label wrap"><Icon name="paw" /> Things real users do that scripts forget</div>
          <div className="marquee">
            <ul className="marquee-track">
              {[...ODD, ...ODD].map((o, i) => <li key={i} aria-hidden={i >= ODD.length || undefined}><span className="odd-dot" />{o}</li>)}
            </ul>
          </div>
        </section>

        {/* How it works — horizontal track */}
        <section id="how" className="wrap how" aria-labelledby="how-title">
          <Reveal className="section-intro">
            <p className="kicker"><span className="rule" aria-hidden /> How a run works</p>
            <h2 id="how-title" className="h1">Four steps. No click scripts.</h2>
          </Reveal>
          <Reveal as="div" className="track">
            <span className="track-line" aria-hidden><i /></span>
            <ol>
              {STEPS.map((s, i) => (
                <li key={s.title} style={{ ['--i' as string]: i }}>
                  <span className="track-node"><Icon name={s.icon} size={24} /></span>
                  <span className="num">0{i + 1}</span>
                  <h3 className="h2">{s.title}</h3>
                  <p>{s.detail}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        {/* Bento: each claim shows its own small visual */}
        <section className="wrap bento-sec" aria-labelledby="trust-title">
          <Reveal className="section-intro">
            <p className="kicker"><span className="rule" aria-hidden /> Why the results hold up</p>
            <h2 id="trust-title" className="h1">Evidence first. Nothing invented.</h2>
          </Reveal>
          <div className="bento">
            <Reveal as="article" className="tile-card b-own">
              <div className="tc-copy"><h3 className="h2">Only sites you own</h3><p>Prove control once. Oddhound re-checks it at the start of every run and refuses private or internal addresses.</p></div>
              <div className="viz-own" aria-hidden>
                <div className="vo-tabs"><span className="on">File</span><span>Meta tag</span><span>DNS TXT</span></div>
                <div className="vo-code"><span className="muted">/.well-known/oddhound-verify.txt</span><span className="vo-type">oh_3f9a2c71e8…</span></div>
                <span className="badge badge-ok vo-badge"><Icon name="check" />Verified</span>
              </div>
            </Reveal>
            <Reveal as="article" className="tile-card b-dev" delay={80}>
              <div className="tc-copy"><h3 className="h2">Desktop and phone</h3><p>The same goals on a 1440px desktop and a 390px phone.</p></div>
              <div className="viz-dev" aria-hidden>
                <span className="vd-desk"><i /><i /><i /></span>
                <span className="vd-phone"><i /><i /></span>
              </div>
            </Reveal>
            <Reveal as="article" className="tile-card b-rep">
              <div className="tc-copy"><h3 className="h2">Verified, not guessed</h3><p>Fresh sessions replay each suspect. Only a broken rule with saved evidence counts.</p></div>
              <div className="viz-rep" aria-hidden>
                <div className="vr-lane"><span>Replay 1</span><i className="vr-bar" /><Icon name="fail" /></div>
                <div className="vr-lane"><span>Replay 2</span><i className="vr-bar" /><Icon name="fail" /></div>
                <div className="vr-lane ok"><span>Valid case</span><i className="vr-bar" /><Icon name="check" /></div>
              </div>
            </Reveal>
            <Reveal as="article" className="tile-card b-fix" delay={80}>
              <div className="tc-copy"><h3 className="h2">The same check after your fix</h3><p>Copy the fix prompt into your coding AI. Retest replays the saved assertion — no auto-healing, no weaker checks.</p></div>
              <div className="viz-fix" aria-hidden>
                <div className="vf-rule">Party size must be 1–8</div>
                <div className="vf-row"><span className="badge badge-bad"><Icon name="bug" />Open</span><span className="vf-arrow"><Icon name="arrow" /></span><span className="badge badge-ok vf-fixed"><Icon name="check" />Fixed</span></div>
                <span className="btn btn-sm vf-copy"><Icon name="brief" /> Copy fix prompt</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="wrap">
          <Reveal className="cta-band">
            <div className="cta-copy">
              <h2 className="h1">Point the hound at your site.</h2>
              <p>Verify it, approve what it may do, and watch it work. Or start with the demo — no account needed.</p>
              <div className="row" style={{ gap: 10, marginTop: 6 }}>
                <Link className="btn btn-primary btn-lg" href={scanHref}><Icon name="sniff" /> Scan your site</Link>
                {status.replayRunId && <Link className="btn btn-lg cta-ghost" href={`/runs/${status.replayRunId}?replay=1`}><Icon name="eye" /> Watch a demo replay</Link>}
              </div>
            </div>
            <div className="cta-art" aria-hidden><HoundFigure size={170} /></div>
          </Reveal>
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
