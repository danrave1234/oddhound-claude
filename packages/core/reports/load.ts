import type { Db } from '../db/pool.ts';
import type { Scenario } from '../verifier/scenario.ts';
import type { BriefInput } from './fix-brief.ts';
import { fetchDocs, topicFor } from '../integrations/context7.ts';

/** Loads everything a fix brief needs for one finding. Caller must already have authorised access. */
export async function loadBriefInput(db: Db, findingId: string): Promise<BriefInput | null> {
  const f = (await db.query(`SELECT f.*, r.origin, r.environment, COALESCE(p.stack, '') AS stack FROM findings f JOIN runs r ON r.id = f.run_id LEFT JOIN projects p ON p.id = r.project_id WHERE f.id = $1`, [findingId])).rows[0];
  if (!f) return null;
  const scenario = f.scenario_id ? (await db.query<{ id: string; assertion: Scenario; assertion_hash: string }>('SELECT id, assertion, assertion_hash FROM scenarios WHERE id = $1', [f.scenario_id])).rows[0] : undefined;
  const control = f.control_scenario_id ? (await db.query<{ assertion: Scenario }>('SELECT assertion FROM scenarios WHERE id = $1', [f.control_scenario_id])).rows[0] : undefined;
  const executions = f.scenario_id ? (await db.query<{ kind: string; outcome: string; at: Date }>('SELECT kind, outcome, at FROM scenario_executions WHERE scenario_id = $1 ORDER BY at', [f.scenario_id])).rows : [];
  return {
    finding: {
      id: f.id, title: f.title, category: f.category, verification: f.verification, lifecycle: f.lifecycle, impact: f.impact, confidence: f.confidence,
      ruleId: f.rule_id, ruleSource: f.rule_source, expected: f.expected, observed: f.observed, device: f.device, actor: f.actor, limitations: f.limitations,
    },
    target: { origin: f.origin, environment: f.environment },
    scenario: scenario ? { id: scenario.id, assertion: scenario.assertion, assertionHash: scenario.assertion_hash } : null,
    control: control ? { assertion: control.assertion } : null,
    executions: executions.map((e) => ({ kind: e.kind, outcome: e.outcome, at: e.at.toISOString() })),
    evidenceCount: (f.evidence_ids as string[]).length,
    // Documentation only for an owner-declared stack, and only for verified issues; failure → null.
    docs: f.stack && scenario && f.category === 'verified_issue' ? await fetchDocs(f.stack, topicFor(scenario.assertion.kind)) : null,
  };
}
