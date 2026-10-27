'use client';
// Small motion helpers. Every effect is skipped when the visitor prefers reduced motion,
// and content is visible without JavaScript (reveal only hides things once JS is running).
import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades/slides children in when they scroll into view. */
export function Reveal({ children, className = '', delay = 0, as: Tag = 'div', style }: {
  children: React.ReactNode; className?: string; delay?: number; as?: 'div' | 'section' | 'li' | 'article'; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !('IntersectionObserver' in window)) { setShown(true); return; }
    setArmed(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const cls = `${className} reveal${armed ? ' reveal-armed' : ''}${shown ? ' in' : ''}`;
  return <Tag ref={ref as never} className={cls} style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}>{children}</Tag>;
}

/** Animates a number from its previous value to the new one. */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), duration = 500 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion() || from.current === value) { from.current = value; setShown(value); return; }
    const start = performance.now(), a = from.current, b = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value, duration]);
  return <span className="tabular">{format(shown)}</span>;
}

/** Current time, re-rendered every `ms` while `enabled`. */
export function useNow(enabled: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [enabled, ms]);
  return now;
}

/** Progress ring with a defined denominator. `value` and `max` are real counts. */
export function Ring({ value, max, size = 56, label, display, spoken, tone = 'accent' }: { value: number; max: number; size?: number; label: string; display: React.ReactNode; spoken: string; tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'info' }) {
  const r = (size - 7) / 2, c = 2 * Math.PI * r;
  const k = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`gauge gauge-${tone}`} role="img" aria-label={`${spoken} ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="gauge-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="gauge-fill" strokeDasharray={c} strokeDashoffset={c * (1 - k)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="gauge-text"><strong>{display}</strong><span>{label}</span></div>
    </div>
  );
}
