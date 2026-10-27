// Coverage of observed states (MVP §7 "Coverage overlay"): every control the scout listed in a page
// state the run reached, and whether the run actually exercised it. The denominator is stated
// ("41 of 63 controls in observed states"); it is never coverage of the whole application.
//
// A control counts as exercised only when a browser action targeted it and succeeded. Controls the
// run may not use (links off the verified site or to paths the contract denies) count as blocked by
// policy. Controls only ever seen disabled are left out until they are seen enabled.

import { routePattern, type Observation, type ObservedElement } from '../browser/snapshot.ts';

type Entry = { route: string; kind: string; label: string; exercised: boolean; blocked: string | null; enabled: boolean };

export type CoverageSummary = {
  total: number;
  exercised: number;
  blocked: number;
  /** Distinct page routes the controls were seen on. */
  pages: number;
  routes: { route: string; total: number; exercised: number; blocked: number }[];
  /** A sample of controls not yet exercised, for the agent's notebook. */
  unexercised: { route: string; kind: string; label: string }[];
};

export class CoverageTracker {
  readonly #entries = new Map<string, Entry>();
  readonly #routes = new Set<string>();
  readonly #blockedReason: (el: ObservedElement, pageUrl: string) => string | null;

  constructor(blockedReason: (el: ObservedElement, pageUrl: string) => string | null) {
    this.#blockedReason = blockedReason;
  }

  #key(route: string, o: Observation, el: ObservedElement): string {
    let id = el.label || el.name || el.href || '';
    if (!id) {
      // Unlabelled controls are told apart by their position among unlabelled controls of the same kind.
      const same = o.elements.filter((e) => e.kind === el.kind && !(e.label || e.name || e.href));
      id = `#${same.indexOf(el) + 1}`;
    }
    return `${route}|${el.kind}|${id}`;
  }

  /** Add every control in an observed state. */
  observe(o: Observation): void {
    const route = routePattern(o.url);
    this.#routes.add(route);
    for (const el of o.elements) {
      const key = this.#key(route, o, el);
      const entry = this.#entries.get(key) ?? { route, kind: el.kind, label: el.label || el.name || el.href || `(unlabelled ${el.kind})`, exercised: false, blocked: null, enabled: false };
      if (!el.disabled) entry.enabled = true;
      if (!entry.exercised && !entry.blocked) entry.blocked = this.#blockedReason(el, o.url);
      this.#entries.set(key, entry);
    }
  }

  /** Mark the control behind `ref` (in observation `o`) as exercised. */
  exercise(o: Observation, ref: string): boolean {
    const el = o.elements.find((e) => e.ref === ref);
    if (!el) return false;
    this.observe(o);
    const entry = this.#entries.get(this.#key(routePattern(o.url), o, el))!;
    entry.exercised = true; entry.enabled = true; entry.blocked = null;
    return true;
  }

  summary(sample = 12): CoverageSummary {
    const counted = [...this.#entries.values()].filter((e) => e.enabled);
    const byRoute = new Map<string, { route: string; total: number; exercised: number; blocked: number }>();
    for (const e of counted) {
      const r = byRoute.get(e.route) ?? { route: e.route, total: 0, exercised: 0, blocked: 0 };
      r.total++; if (e.exercised) r.exercised++; else if (e.blocked) r.blocked++;
      byRoute.set(e.route, r);
    }
    return {
      total: counted.length,
      exercised: counted.filter((e) => e.exercised).length,
      blocked: counted.filter((e) => !e.exercised && e.blocked).length,
      pages: this.#routes.size,
      routes: [...byRoute.values()].sort((a, b) => b.total - a.total).slice(0, 30),
      unexercised: counted.filter((e) => !e.exercised && !e.blocked).slice(0, sample).map((e) => ({ route: e.route, kind: e.kind, label: e.label.slice(0, 60) })),
    };
  }
}
