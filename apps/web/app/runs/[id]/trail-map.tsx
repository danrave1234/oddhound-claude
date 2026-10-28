'use client';
// Pages the agent reached, laid out as stops on a winding trail. The hound walks to each new stop
// as it is recorded (or replayed). Drawn in pixel units so labels stay legible at any width.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HOUND_PATH, HOUND_VIEWBOX } from '@/ui/icons';

export type TrailPage = { key: string; route: string; title: string; device: string };

const ROW_H = 94, PAD_X = 50, TOP = 40, MAX_SHOWN = 24;
const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const isId = (seg: string) => /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /-[0-9a-f]{6,}$/i.test(seg) || seg.startsWith(':');
const words = (seg: string) => { const w = seg.replace(/[-_]+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };

/** A readable name for a page from its address: "/settings/account" -> "Settings › Account", "/notes/42" -> "Notes › one record". */
export function pageName(route: string): string {
  const segs = route.split('?')[0]!.split('/').filter(Boolean);
  if (!segs.length) return 'Home';
  const named = segs.map((s) => (isId(s) ? 'one record' : words(s)));
  return named.slice(-2).join(' › ');
}

/** Consecutive page states on the same address are one stop (a dialog or tab on that page is not a new page). */
export function trailStops<T extends TrailPage>(pages: T[]): (T & { visits: number })[] {
  const out: (T & { visits: number })[] = [];
  for (const p of pages) {
    const prev = out[out.length - 1];
    if (prev && prev.route === p.route && prev.device === p.device) prev.visits++;
    else out.push({ ...p, visits: 1 });
  }
  return out;
}

export function TrailMap({ pages, live }: { pages: TrailPage[]; live: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useIsoLayout(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const grouped = useMemo(() => trailStops(pages), [pages]);
  const hidden = Math.max(0, grouped.length - MAX_SHOWN);
  const shown = useMemo(() => grouped.slice(hidden), [grouped, hidden]);
  const perRow = Math.max(2, Math.min(7, Math.floor((width - PAD_X * 2) / 128) + 1));
  const gap = perRow > 1 ? (width - PAD_X * 2) / (perRow - 1) : 0;

  // Boustrophedon layout: left to right, then right to left, like a trail doubling back.
  const stops = useMemo(() => shown.map((p, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const x = PAD_X + (row % 2 === 0 ? col : perRow - 1 - col) * gap;
    return { ...p, x, y: TOP + row * ROW_H, row };
  }), [shown, perRow, gap]);

  const d = useMemo(() => {
    if (!stops.length) return '';
    let path = `M ${stops[0]!.x} ${stops[0]!.y}`;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!, b = stops[i]!;
      if (a.row === b.row) path += ` C ${(a.x + b.x) / 2} ${a.y - 14}, ${(a.x + b.x) / 2} ${b.y + 14}, ${b.x} ${b.y}`;
      else { const side = a.row % 2 === 0 ? 1 : -1; const bend = a.x + side * 44; path += ` C ${bend} ${a.y}, ${bend} ${b.y}, ${b.x} ${b.y}`; }
    }
    return path;
  }, [stops]);

  const rows = stops.length ? stops[stops.length - 1]!.row + 1 : 1;
  const height = TOP + (rows - 1) * ROW_H + 40;
  const last = stops[stops.length - 1];
  const prev = stops[stops.length - 2];
  const facingLeft = last ? (prev ? last.x < prev.x || (last.row % 2 === 1 && last.x === prev.x) : false) : false;
  // Edge stops have only PAD_X of room on one side, so cap label length to fit there too.
  const labelChars = Math.max(8, Math.min(Math.floor(gap / 7.2), Math.floor((PAD_X * 2 + 10) / 6.6)));

  return (
    <div className="tmap" ref={wrap}>
      <ol className="sr-only" aria-label="Pages discovered, in order">{pages.map((p) => <li key={p.key}>{pageName(p.route)} ({p.route}, {p.device})</li>)}</ol>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
        <path d={d} className="tmap-path" />
        {stops.map((s, i) => {
          const isLast = i === stops.length - 1;
          return (
            <g key={s.key} transform={`translate(${s.x} ${s.y})`} className={`tmap-stop${isLast ? ' last' : ''}${isLast && live ? ' fresh' : ''}`}>
              <title>{`${pageName(s.route)} — ${s.route}${s.visits > 1 ? ` (${s.visits} states in a row: dialogs, tabs or form changes on this page)` : ''}`}</title>
              <circle r={isLast ? 9 : 6.5} className="tmap-dot" />
              {s.device === 'mobile' && <rect x={-2.5} y={-4} width={5} height={8} rx={1.2} className="tmap-phone" />}
              <text y={24} textAnchor="middle" className="tmap-title">{short(pageName(s.route), labelChars)}</text>
              <text y={38} textAnchor="middle" className="tmap-route">{short(s.visits > 1 ? `${s.route} ×${s.visits}` : s.route, labelChars + 2)}</text>
            </g>
          );
        })}
        {last && (
          <g className="tmap-hound" style={{ transform: `translate(${last.x}px, ${last.y - 30}px)` }}>
            <g style={{ transform: facingLeft ? 'scaleX(-1)' : undefined }}>
              <svg x={-14} y={-15} width={28} height={28} viewBox={HOUND_VIEWBOX} overflow="visible">
                <path d={HOUND_PATH} fill="currentColor" fillRule="evenodd" />
                {live && <g key={last.key} className="tmap-sniff" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"><path d="M46 26a3.4 3.4 0 0 1 0 5" /><path d="M48.6 23.6a6.6 6.6 0 0 1 0 9.8" opacity=".55" /></g>}
              </svg>
            </g>
          </g>
        )}
      </svg>
      {hidden > 0 && <p className="tmap-more">{hidden} earlier {hidden === 1 ? 'stop' : 'stops'} not shown</p>}
    </div>
  );
}
