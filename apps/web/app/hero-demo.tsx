import { Icon } from '@/ui/icons';

/**
 * Animated illustration of one exploratory loop on the demo target's labelled defect
 * (a booking with a party size of 0 is accepted). Labelled as an illustration; CSS only.
 * With reduced motion it shows the final frame.
 */
export function HeroDemo() {
  return (
    <figure className="demo" aria-label="Illustration: Oddhound types an unexpected party size, the site accepts it, and Oddhound reports a verified rule violation.">
      <div className="demo-bar">
        <span className="demo-addr"><Icon name="lock" /><span>staging.your-site.example/book</span></span>
        <span className="chip">Illustration</span>
      </div>
      <div className="demo-stage" aria-hidden>
        {/* The site under test */}
        <div className="d-form">
          <div className="d-title">Book a table</div>
          <div className="d-label" style={{ top: '19%' }}>Name</div>
          <div className="d-input" style={{ top: '25%' }}><span className="d-val d-val-1">Ada Tester</span></div>
          <div className="d-label" style={{ top: '41%' }}>Party size</div>
          <div className="d-input d-input-odd" style={{ top: '47%' }}><span className="d-val d-val-2">0</span></div>
          <div className="d-label" style={{ top: '63%' }}>Date</div>
          <div className="d-input" style={{ top: '69%' }}><span className="d-val d-val-3">Fri 7:30 pm</span></div>
          <div className="d-btn">Book</div>
          <div className="d-saved"><Icon name="check" /> Booking saved</div>
        </div>

        {/* Oddhound's factual activity */}
        <ol className="d-feed">
          <li className="d-f1"><Icon name="paw" /> Typed a name</li>
          <li className="d-f2"><Icon name="paw" /> Typed <b>0</b> into Party size</li>
          <li className="d-f3"><Icon name="paw" /> Submitted the form</li>
          <li className="d-f4"><Icon name="replay" /> Replaying in a fresh session</li>
        </ol>

        {/* The finding */}
        <div className="d-finding">
          <div className="d-finding-top"><span className="badge badge-bad"><Icon name="bug" />Verified issue</span><span className="d-replays"><i /><i /> 2/2 replays</span></div>
          <strong>A booking with a party size of 0 is accepted</strong>
          <span className="d-rule">Breaks rule R1: party size must be 1 to 8</span>
        </div>

        <svg className="d-cursor" width="22" height="22" viewBox="0 0 16 16"><path d="M3 1.8l10 4.6-4.3 1.4-1.5 4.4z" fill="#1c1b19" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" /></svg>
        <span className="d-click" />
      </div>
    </figure>
  );
}
