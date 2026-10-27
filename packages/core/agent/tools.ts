// Constrained tool contracts exposed to the model. Each tool has a JSON schema for the provider and
// a zod schema the worker validates against before anything executes. There is no eval, shell,
// arbitrary fetch, file access or page JavaScript tool.

import { z } from 'zod';
import type { ToolDefinition } from '../providers/types.ts';
import { ScenarioSchema } from '../verifier/scenario.ts';

const ref = z.string().regex(/^e\d{1,4}$/);

export const ToolArgs = {
  observe: z.object({ screenshot: z.boolean().optional() }),
  navigate: z.object({ path: z.string().startsWith('/').max(300) }),
  click: z.object({ ref }),
  fill: z.object({ ref, value: z.string().max(500) }),
  fill_credential: z.object({ ref, credential_ref: z.string().regex(/^cred_[A-Za-z0-9_-]{6,64}$/), field: z.enum(['username', 'password']) }),
  fill_form: z.object({ fields: z.array(z.union([
    z.object({ ref, value: z.string().max(500) }),
    z.object({ ref, credential_ref: z.string().regex(/^cred_[A-Za-z0-9_-]{6,64}$/), field: z.enum(['username', 'password']) }),
  ])).min(1).max(12) }),
  create_identity: z.object({}),
  select_option: z.object({ ref, value: z.string().max(200) }),
  press_key: z.object({ key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Space']) }),
  scroll: z.object({ to: z.enum(['top', 'up', 'down', 'bottom']) }),
  go_back: z.object({}),
  set_device: z.object({ device: z.enum(['desktop', 'mobile']) }),
  use_actor: z.object({ actor: z.enum(['A', 'B']) }),
  boundary_values: z.object({ kind: z.enum(['integer', 'text', 'date']), min: z.number().optional(), max: z.number().optional() }),
  update_workflow: z.object({ name: z.string().min(2).max(60), status: z.enum(['discovered', 'exploring', 'testing', 'blocked', 'completed']), summary: z.string().max(300) }),
  report_candidate: z.object({
    title: z.string().min(5).max(140),
    rule_id: z.string().max(32),
    impact: z.enum(['high', 'medium', 'low']),
    observed: z.string().min(5).max(500),
    scenario: ScenarioSchema,
    control_values: z.record(z.string(), z.string().max(200)).optional(),
  }),
  finish_run: z.object({ summary: z.string().min(5).max(800) }),
} as const;
export type ToolName = keyof typeof ToolArgs;
export const BROWSER_TOOLS = new Set<ToolName>(['navigate', 'click', 'fill', 'fill_credential', 'fill_form', 'select_option', 'press_key', 'scroll', 'go_back', 'set_device', 'use_actor']);

const s = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const refProp = { type: 'string', description: 'Element reference from the latest observation, e.g. "e7".' };
const fieldMap = { type: 'object', description: 'Map of field label (as shown on the page) to value. Templates: {name} {email} {password} {marker} {date+7} {date-1}.', additionalProperties: { type: 'string' } };
const authRecipe = s({
  kind: { type: 'string', enum: ['register'] }, path: { type: 'string' }, fields: fieldMap,
  submit: { type: 'string', description: 'Visible text of the submit button' },
  successText: { type: 'string', description: 'Text visible only after successful sign-up, e.g. "Log out"' },
}, ['kind', 'path', 'fields', 'submit', 'successText']);
const form = s({ path: { type: 'string' }, fields: fieldMap, submit: { type: 'string' } }, ['path', 'fields', 'submit']);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { type: 'function', function: { name: 'observe', description: 'Return a compact observation of the current page with element references. Set screenshot=true only when layout matters.', parameters: s({ screenshot: { type: 'boolean' } }) } },
  { type: 'function', function: { name: 'navigate', description: 'Open a path on the verified site (same origin only), e.g. "/bookings".', parameters: s({ path: { type: 'string' } }, ['path']) } },
  { type: 'function', function: { name: 'click', description: 'Click an element by reference, like a normal user.', parameters: s({ ref: refProp }, ['ref']) } },
  { type: 'function', function: { name: 'fill', description: 'Type a value into an input or textarea. Do not use for passwords.', parameters: s({ ref: refProp, value: { type: 'string' } }, ['ref', 'value']) } },
  { type: 'function', function: { name: 'fill_credential', description: 'Fill a username/email or password field from a credential reference. You never see the secret.', parameters: s({ ref: refProp, credential_ref: { type: 'string' }, field: { type: 'string', enum: ['username', 'password'] } }, ['ref', 'credential_ref', 'field']) } },
  { type: 'function', function: { name: 'fill_form', description: 'Fill several fields of the current form in one step (does not submit). Each entry is {ref, value} or, for secrets, {ref, credential_ref, field}. Then click the submit button.', parameters: s({ fields: { type: 'array', items: { type: 'object', properties: { ref: refProp, value: { type: 'string' }, credential_ref: { type: 'string' }, field: { type: 'string', enum: ['username', 'password'] } }, required: ['ref'] } } }, ['fields']) } },
  { type: 'function', function: { name: 'create_identity', description: 'Create a new synthetic test identity for registration (limited per run). Returns name, email and a credential_ref for the password.', parameters: s({}) } },
  { type: 'function', function: { name: 'select_option', description: 'Choose an option in a select element.', parameters: s({ ref: refProp, value: { type: 'string' } }, ['ref', 'value']) } },
  { type: 'function', function: { name: 'press_key', description: 'Press a key in the focused element.', parameters: s({ key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Space'] } }, ['key']) } },
  { type: 'function', function: { name: 'scroll', description: 'Scroll the page.', parameters: s({ to: { type: 'string', enum: ['top', 'up', 'down', 'bottom'] } }, ['to']) } },
  { type: 'function', function: { name: 'go_back', description: 'Browser Back button.', parameters: s({}) } },
  { type: 'function', function: { name: 'set_device', description: 'Switch to the desktop (1440x900) or mobile (390x844) profile for the current actor.', parameters: s({ device: { type: 'string', enum: ['desktop', 'mobile'] } }, ['device']) } },
  { type: 'function', function: { name: 'use_actor', description: 'Switch to actor A or B. Each actor has its own isolated session (for two-account checks).', parameters: s({ actor: { type: 'string', enum: ['A', 'B'] } }, ['actor']) } },
  { type: 'function', function: { name: 'boundary_values', description: 'Get boundary test values generated in code (no browser action).', parameters: s({ kind: { type: 'string', enum: ['integer', 'text', 'date'] }, min: { type: 'number' }, max: { type: 'number' } }, ['kind']) } },
  { type: 'function', function: { name: 'update_workflow', description: 'Name and update a workflow you discovered (e.g. "Registration", "Create booking").', parameters: s({ name: { type: 'string' }, status: { type: 'string', enum: ['discovered', 'exploring', 'testing', 'blocked', 'completed'] }, summary: { type: 'string' } }, ['name', 'status', 'summary']) } },
  {
    type: 'function', function: {
      name: 'report_candidate',
      description: 'Report a suspected rule violation as a replayable scenario. Oddhound replays it independently in fresh sessions before calling it verified. Use field labels exactly as shown on the page. Put {marker} in one free-text field so persistence can be detected.',
      parameters: s({
        title: { type: 'string' }, rule_id: { type: 'string', description: 'Owner rule ID, e.g. "R1"' },
        impact: { type: 'string', enum: ['high', 'medium', 'low'] }, observed: { type: 'string', description: 'What you saw, factually' },
        scenario: {
          oneOf: [
            s({ kind: { const: 'form_rule' }, device: { type: 'string', enum: ['desktop', 'mobile'] }, auth: authRecipe, form, testedField: { type: 'string', description: 'Label of the field whose value breaks the rule. Never put {marker} in this field.' }, expectation: { type: 'string', enum: ['rejected', 'accepted'] }, listPath: { type: 'string' } }, ['kind', 'device', 'form', 'testedField', 'expectation', 'listPath']),
            s({ kind: { const: 'cross_account_read' }, device: { type: 'string', enum: ['desktop', 'mobile'] }, auth: authRecipe, create: form, listPath: { type: 'string' }, expectation: { const: 'denied' } }, ['kind', 'device', 'auth', 'create', 'listPath', 'expectation']),
            s({ kind: { const: 'mobile_reachability' }, device: { const: 'mobile' }, auth: authRecipe, path: { type: 'string' }, control: { type: 'string' }, expectation: { const: 'reachable' } }, ['kind', 'device', 'path', 'control', 'expectation']),
          ],
        },
        control_values: { type: 'object', description: 'For form_rule: valid values for the same fields that must still be accepted (the neighbouring control).', additionalProperties: { type: 'string' } },
      }, ['title', 'rule_id', 'impact', 'observed', 'scenario']),
    },
  },
  { type: 'function', function: { name: 'finish_run', description: 'End the exploration with a short factual summary.', parameters: s({ summary: { type: 'string' } }, ['summary']) } },
];

export function boundaryValues(kind: 'integer' | 'text' | 'date', min?: number, max?: number): string[] {
  if (kind === 'integer') {
    const lo = min ?? 1, hi = max ?? 100;
    return [...new Set([lo - 1, lo, hi, hi + 1, 0, -1, 1.5, 999999].map(String))];
  }
  if (kind === 'date') {
    const d = (n: number) => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    return [d(-1), d(0), d(1), d(365), '2024-02-30'];
  }
  return ['', '   ', 'O\'Brien', 'Zoë 名前', 'x'.repeat((max ?? 120) + 1), '<b>marker</b>'];
}
