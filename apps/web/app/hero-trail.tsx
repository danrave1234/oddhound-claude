/**
 * The landing page's one orchestrated moment: a scent trail draws across the hero, paw prints
 * land in step, and the hound runs along it and stops to sniff. With reduced motion the finished
 * trail is shown with the hound already at the end.
 */
const TRAIL = 'M 20 62 C 170 14 260 88 420 52 C 580 16 660 22 800 54 C 940 86 1040 70 1150 40';
const LENGTH = 1143;
const START = 0.3, DUR = 2.2; // seconds
// Paw positions along the trail (alternating sides), rotation and share of the distance travelled.
const PAWS: [number, number, number, number][] = [
  [97, 34.5, 85.5, 0.07], [211, 63.9, 97.4, 0.17], [325.2, 50.3, 90.1, 0.27], [441.3, 59.6, 78.1, 0.37], [550.7, 18, 84.9, 0.47],
  [664.4, 42.2, 95.6, 0.57], [780, 37.2, 102.3, 0.67], [889.8, 80.8, 95.3, 0.77], [1003.5, 56.8, 84.4, 0.87],
];

function Paw({ x, y, r, delay }: { x: number; y: number; r: number; delay: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(1.35)`}>
      <g className="ht-paw" style={{ animationDelay: `${delay}s` }}>
        <ellipse cx="-4.6" cy="-2.6" rx="1.7" ry="2.2" /><ellipse cx="-1.5" cy="-6" rx="1.7" ry="2.2" /><ellipse cx="2.3" cy="-6" rx="1.7" ry="2.2" /><ellipse cx="5.2" cy="-2.6" rx="1.7" ry="2.2" />
        <path d="M.4 -1.4c2.4 0 4.5 2.7 4.5 4.8 0 1.6-1.1 2.4-2.4 2.4-.9 0-1.3-.4-2.1-.4s-1.3.4-2.1.4c-1.3 0-2.4-.8-2.4-2.4 0-2.1 2.1-4.8 4.5-4.8z" />
      </g>
    </g>
  );
}

function RunningHound() {
  // Same drawing as the brand mascot, scaled for the trail; it faces the direction of travel.
  return (
    <g transform="translate(-52 -80) scale(3.2)">
      <path d="M9.4 8.6C10.9 6.7 13.5 6 15.9 6.5c2 .4 3.4 1.8 4.5 3.4l4.9 2.5c1.4.8 1.8 2.5.9 3.8-.6.8-1.6 1.1-2.6.9l-3-.4c-.6 1.8-1.6 3.6-2.7 4.8l-1.2 4H10.4c.4-2.8 0-5.2-1.2-7.2-1.3-2.3-1.4-7.2.2-9.7z" fill="var(--hound-face)" stroke="var(--hound-line)" strokeWidth=".7" />
      <path className="ht-ear" d="M11.3 8.4c-1.9 1-2.9 3.9-2.5 7.3.3 2.6 1.4 4.8 2.8 5.2 1.1.3 1.8-.7 1.9-2.1.2-3.3.1-7.1-.6-9.3-.3-1-1-1.4-1.6-1.1z" fill="var(--hound-ear)" />
      <circle cx="17.4" cy="11" r="1.05" fill="var(--hound-ink)" /><circle cx="25.5" cy="14.1" r="1.2" fill="var(--hound-ink)" />
      <path d="M10.6 22.4h6.5l-.4 1.7h-6.1z" fill="var(--blaze)" />
      <g className="ht-sniff" stroke="var(--blaze)" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M28.1 12.4a2.6 2.6 0 0 1 0 3.6" /><path d="M30 10.9a4.8 4.8 0 0 1 0 6.6" opacity=".55" />
      </g>
    </g>
  );
}

export function HeroTrail() {
  return (
    <div className="ht" aria-hidden>
      <svg viewBox="0 0 1240 100" preserveAspectRatio="xMinYMid meet" focusable="false">
        <defs>
          <mask id="ht-reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="100">
            <path className="ht-draw" d={TRAIL} stroke="#fff" strokeWidth="14" fill="none" strokeDasharray={LENGTH} strokeDashoffset={LENGTH}
              style={{ animationDelay: `${START}s`, animationDuration: `${DUR}s` }} />
          </mask>
          <path id="ht-path" d={TRAIL} />
        </defs>
        <path d={TRAIL} className="ht-line" mask="url(#ht-reveal)" />
        <g className="ht-paws">{PAWS.map(([x, y, r, f]) => <Paw key={x} x={x} y={y} r={r} delay={START + DUR * f} />)}</g>
        <g className="ht-hound-run">
          <RunningHound />
          <animateMotion dur={`${DUR}s`} begin={`${START}s`} fill="freeze" calcMode="paced"><mpath href="#ht-path" /></animateMotion>
        </g>
        <g className="ht-hound-rest" transform="translate(1150 40)"><RunningHound /></g>
      </svg>
    </div>
  );
}
