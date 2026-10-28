// OFFLINE TEST DOUBLE — NOT META INFERENCE.
//
// A deterministic planner that speaks the same ChatProvider contract so the whole pipeline (tools,
// ledger, scope, verification, retest, UI) can be tested without paid model calls. It reads the same
// observations a model receives and picks elements by their visible labels; it has no knowledge of
// the demo target's seeded defects or selectors. It is never a Meta model: isMetaModel is false, so
// hosted runs refuse it, and every run that uses it is labelled "offline test double".

import { randomUUID } from 'node:crypto';
import type { ChatProvider, ChatRequest, ChatResult, ChatMessage, ToolCall } from '../providers/types.ts';

type El = { ref: string; kind: string; label: string; attrs: string };

function lastObservation(messages: ChatMessage[]): { path: string; els: El[]; messages: string[]; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    // After the conversation is compacted, the current page is inside Oddhound's notebook.
    const fromNotebook = m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('NOTEBOOK');
    if (!fromNotebook && (m.role !== 'tool' || !m.content.includes('PAGE v') || m.content.startsWith('[older'))) continue;
    const content = m.content as string;
    if (!content.includes('PAGE v')) continue;
    const lines = content.slice(content.indexOf('PAGE v')).split('\n');
    const head = lines.find((l) => l.startsWith('PAGE v'))!;
    const path = /^PAGE v\d+: (\S+)/.exec(head)?.[1] ?? '/';
    const els: El[] = [];
    for (const l of lines) {
      const mm = /^\[(e\d+)\] (\w+) ("(?:[^"\\]|\\.)*")\s*(.*)$/.exec(l);
      if (mm) els.push({ ref: mm[1]!, kind: mm[2]!, label: JSON.parse(mm[3]!), attrs: mm[4] ?? '' });
    }
    const msgLine = lines.find((l) => l.startsWith('messages: ')) ?? '';
    const text = content.split('<<<UNTRUSTED_PAGE_TEXT')[1] ?? '';
    return { path, els, messages: msgLine ? [msgLine.slice(10)] : [], text };
  }
  return null;
}

function lastToolJson(messages: ChatMessage[], key: string): Record<string, string> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'tool' && m.content.startsWith('{') && m.content.includes(key)) { try { return JSON.parse(m.content); } catch { return null; } }
  }
  return null;
}

const date = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const find = (els: El[], kind: string | string[], re: RegExp) => els.find((e) => (Array.isArray(kind) ? kind.includes(e.kind) : e.kind === kind) && re.test(e.label));

export class HeuristicTestPlanner implements ChatProvider {
  readonly id = 'test-double';
  readonly model = 'heuristic-planner';
  readonly isMetaModel = false;
  readonly label = 'Offline test double (not Meta inference)';
  readonly capability = { tools: true, images: false, imagesInToolMessages: false, toolChoiceValues: ['auto'] as const, structuredOutput: false };

  #step = 0;
  #queue: { name: string; args: Record<string, unknown> }[] = [];
  #ident: Record<string, string> | null = null;
  #labels: Record<string, string> = {};
  #formPath = '/';
  #listPath = '/';
  #registerPath = '/';
  #registerFields: Record<string, string> = {};
  #registerSubmit = '';
  #successText = '';
  #bookingSubmit = '';
  #firstRecordPath = '';
  #editLabels: { party: string; notes: string } = { party: '', notes: '' };

  async chat(req: ChatRequest): Promise<ChatResult> {
    // A new run starts with [system, "Begin..."]; a compacted conversation ([system, notebook]) is the same run.
    const first = req.messages[1];
    if (req.messages.length <= 2 && !(first?.role === 'user' && typeof first.content === 'string' && first.content.startsWith('NOTEBOOK'))) { this.#step = 0; this.#queue = []; }
    const call = this.#next(req.messages);
    // A form's queued fills and its submit go out in the same turn (refs stay valid within a turn), as a model would send them.
    const calls = call ? [call, ...this.#queue.splice(0)] : [];
    const toolCalls: ToolCall[] = calls.map((c) => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    return {
      message: { role: 'assistant', content: null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      finishReason: 'tool_calls',
      requestId: null,
      model: this.model,
    };
  }

  #auth() {
    return { kind: 'register', path: this.#registerPath, fields: this.#registerFields, submit: this.#registerSubmit, successText: this.#successText };
  }

  #bookingFields(values: { guest: string; party: string; date: string; notes: string }) {
    return { [this.#labels.guest!]: values.guest, [this.#labels.party!]: values.party, [this.#labels.date!]: values.date, [this.#labels.notes!]: values.notes };
  }

  /** Fill the booking form currently shown and submit it. */
  #fillBooking(els: El[], v: { guest: string; party: string; date: string; notes: string }) {
    const guest = find(els, 'input', /guest|name/i), party = find(els, 'input', /party|guests|size|people/i);
    const day = find(els, 'input', /date|day/i), notes = find(els, ['textarea', 'input'], /note|comment|request/i);
    const submit = find(els, 'button', /book|reserve|save|submit/i);
    if (!guest || !party || !day || !submit) return false;
    this.#labels = { guest: guest.label, party: party.label, date: day.label, notes: notes?.label ?? '' };
    this.#bookingSubmit ||= submit.label;
    this.#queue.push(
      { name: 'fill', args: { ref: guest.ref, value: v.guest } },
      { name: 'fill', args: { ref: party.ref, value: v.party } },
      { name: 'fill', args: { ref: day.ref, value: v.date } },
      ...(notes ? [{ name: 'fill', args: { ref: notes.ref, value: v.notes } }] : []),
      { name: 'click', args: { ref: submit.ref } },
    );
    return true;
  }

  #accepted(o: NonNullable<ReturnType<typeof lastObservation>>, marker: string) {
    return o.text.includes(marker) || /confirmed/i.test(o.messages.join(' '));
  }

  #next(messages: ChatMessage[]): { name: string; args: Record<string, unknown> } | null {
    if (this.#queue.length) return this.#queue.shift()!;
    const o = lastObservation(messages);
    const step = this.#step++;
    switch (step) {
      case 0: return { name: 'observe', args: {} };
      case 1: {
        const link = o && find(o.els, ['link', 'button'], /create account|sign up|register/i);
        return link ? { name: 'click', args: { ref: link.ref } } : { name: 'finish_run', args: { summary: 'No registration entry point found.' } };
      }
      case 2: { this.#registerPath = o!.path; return { name: 'create_identity', args: {} }; }
      case 3: {
        this.#ident = lastToolJson(messages, 'credential_ref');
        const name = find(o!.els, 'input', /name/i), email = find(o!.els, 'input', /e-?mail/i), pass = find(o!.els, 'input', /password/i);
        const submit = find(o!.els, 'button', /create|sign up|register/i);
        if (!name || !email || !pass || !submit || !this.#ident) return { name: 'finish_run', args: { summary: 'Registration form not understood.' } };
        this.#registerFields = { [name.label]: '{name}', [email.label]: '{email}', [pass.label]: '{password}' };
        this.#registerSubmit = submit.label;
        this.#queue.push(
          { name: 'fill', args: { ref: email.ref, value: this.#ident.email } },
          { name: 'fill_credential', args: { ref: pass.ref, credential_ref: this.#ident.credential_ref, field: 'password' } },
          { name: 'click', args: { ref: submit.ref } },
        );
        return { name: 'fill', args: { ref: name.ref, value: this.#ident.name } };
      }
      case 4: {
        const logout = find(o!.els, 'button', /log ?out|sign ?out/i);
        this.#successText = logout?.label ?? 'Log out';
        this.#listPath = o!.path.split('?')[0]!;
        return { name: 'update_workflow', args: { name: 'Registration', status: logout ? 'completed' : 'blocked', summary: logout ? 'Created a synthetic account and reached the signed-in area.' : 'Sign-up did not reach a signed-in page.' } };
      }
      case 5: {
        const link = find(o!.els, 'link', /^(new|book a|reserve|make a)/i) ?? find(o!.els, 'link', /new/i);
        return link ? { name: 'click', args: { ref: link.ref } } : { name: 'finish_run', args: { summary: 'No booking entry point found.' } };
      }
      case 6: {
        this.#formPath = o!.path;
        if (!this.#fillBooking(o!.els, { guest: 'Ada Tester', party: '2', date: date(7), notes: 'baseline booking' })) return { name: 'finish_run', args: { summary: 'Booking form not understood.' } };
        return this.#queue.shift()!;
      }
      case 7: {
        const ok = this.#accepted(o!, 'Ada Tester');
        const link = o!.els.find((e) => e.kind === 'link' && /^#\d+/.test(e.label));
        if (link) this.#firstRecordPath = /href=(\S+)/.exec(link.attrs)?.[1] ?? '';
        // Family 3: a list with a summary line is checked against its own table (numbers parsed by Oddhound).
        const header = o!.text.match(/\b(Total \w+)\s*:/)?.[1];
        const column = o!.els.length && /Party/.test(o!.text) ? 'Party' : undefined;
        if (header && column) this.#queue.push({ name: 'check_invariant', args: { kind: 'sum', total_label: header, column, evidence: `The list shows a ${column} column and a "${header}" line`, rule_id: 'R7' } });
        if (/\bBookings\s*:\s*\d/.test(o!.text)) this.#queue.push({ name: 'check_invariant', args: { kind: 'count', total_label: 'Bookings', evidence: 'The list shows a Bookings count next to its table' } });
        return { name: 'update_workflow', args: { name: 'Create booking', status: ok ? 'completed' : 'blocked', summary: ok ? 'A valid booking for 2 guests was accepted.' : 'A valid booking was not accepted.' } };
      }
      case 8: return { name: 'boundary_values', args: { kind: 'integer', min: 1, max: 8 } };
      case 9: return { name: 'navigate', args: { path: this.#formPath } };
      case 10: { this.#fillBooking(o!.els, { guest: 'Boundary Zero', party: '0', date: date(7), notes: 'party-zero-check' }); return this.#queue.shift()!; }
      case 11: {
        if (this.#accepted(o!, 'Boundary Zero')) {
          return { name: 'report_candidate', args: {
            title: 'A booking with a party size of 0 is accepted', rule_id: 'R1', impact: 'medium',
            observed: 'Submitting party size 0 returned to the bookings list with the booking confirmed.',
            scenario: { kind: 'form_rule', device: 'desktop', auth: this.#auth(), form: { path: this.#formPath, fields: this.#bookingFields({ guest: 'Boundary {marker}', party: '0', date: '{date+7}', notes: '{marker}' }), submit: this.#bookingSubmit }, testedField: this.#labels.party, expectation: 'rejected', listPath: this.#listPath },
            control_values: { [this.#labels.party!]: '2' },
          } };
        }
        return { name: 'observe', args: {} };
      }
      case 12: return { name: 'navigate', args: { path: this.#formPath } };
      case 13: { this.#fillBooking(o!.els, { guest: '   ', party: '2', date: date(7), notes: 'whitespace-name-check' }); return this.#queue.shift()!; }
      case 14: {
        if (/confirmed/i.test(o!.messages.join(' '))) {
          return { name: 'report_candidate', args: {
            title: 'A booking with a blank (spaces only) guest name is accepted', rule_id: 'R2', impact: 'low',
            observed: 'Submitting a guest name of three spaces was accepted and confirmed.',
            scenario: { kind: 'form_rule', device: 'desktop', auth: this.#auth(), form: { path: this.#formPath, fields: this.#bookingFields({ guest: '   ', party: '2', date: '{date+7}', notes: '{marker}' }), submit: this.#bookingSubmit }, testedField: this.#labels.guest, expectation: 'rejected', listPath: this.#listPath },
            control_values: { [this.#labels.guest!]: 'Valid Guest' },
          } };
        }
        return { name: 'observe', args: {} };
      }
      case 15: return { name: 'navigate', args: { path: this.#formPath } };
      case 16: { this.#fillBooking(o!.els, { guest: 'Past Date', party: '2', date: date(-1), notes: 'past-date-check' }); return this.#queue.shift()!; }
      case 17: {
        const rejected = !/confirmed/i.test(o!.messages.join(' ')) && o!.messages.length > 0;
        return { name: 'update_workflow', args: { name: 'Booking validation', status: 'testing', summary: rejected ? 'Past dates are rejected (rule R3 held). Party size 0 and blank names were tried.' : 'Past date result unclear.' } };
      }
      case 18: return this.#firstRecordPath ? { name: 'navigate', args: { path: this.#firstRecordPath } } : { name: 'observe', args: {} };
      case 19: { const edit = find(o!.els, 'link', /edit/i); return edit ? { name: 'click', args: { ref: edit.ref } } : { name: 'observe', args: {} }; }
      case 20: {
        const party = find(o!.els, 'input', /party|size/i), notes = find(o!.els, ['textarea', 'input'], /note|comment|request/i), save = find(o!.els, 'button', /save|update/i);
        if (party && save) {
          this.#editLabels = { party: party.label, notes: notes?.label ?? '' };
          if (notes) this.#queue.push({ name: 'fill', args: { ref: notes.ref, value: 'Edited note from the test double' } });
          this.#queue.push({ name: 'click', args: { ref: save.ref } });
          return { name: 'fill', args: { ref: party.ref, value: '3' } };
        }
        return { name: 'observe', args: {} };
      }
      // Family 1: the page's own success message after the edit, checked against a reload and the edit form.
      case 21: {
        const claim = /^"((?:[^"\\]|\\.)*)"/.exec(o!.messages[0] ?? '')?.[1];
        const fields = [this.#editLabels.party, this.#editLabels.notes].filter(Boolean);
        return fields.length ? { name: 'check_claim', args: { ...(claim ? { claim } : {}), fields, revisit_path: `${this.#firstRecordPath}/edit` } } : { name: 'observe', args: {} };
      }
      // Family 2, two tabs: two different fields of the same booking from two tabs.
      case 22: return this.#firstRecordPath && this.#labels.guest
        ? { name: 'check_two_tabs', args: { path: `${this.#firstRecordPath}/edit`, first: { field: this.#labels.guest, value: 'Ada Tester Two Tabs' }, second: { field: this.#labels.party!, value: '4' }, rule_id: 'R6' } }
        : { name: 'observe', args: {} };
      case 23: {
        if (!this.#firstRecordPath) return { name: 'observe', args: {} };
        // Family 5: the record's page on desktop vs. a phone, then only its Cancel button (the control).
        this.#queue.push(
          { name: 'check_differential', args: { path: this.#firstRecordPath, rule_id: 'R8' } },
          { name: 'check_differential', args: { path: this.#firstRecordPath, controls: ['Cancel booking'] } },
        );
        return { name: 'navigate', args: { path: this.#firstRecordPath } };
      }
      case 24: { const cancel = find(o!.els, 'button', /cancel/i); return cancel ? { name: 'click', args: { ref: cancel.ref } } : { name: 'observe', args: {} }; }
      case 25: return { name: 'update_workflow', args: { name: 'Edit and cancel booking', status: /cancelled/i.test(o!.text) ? 'completed' : 'blocked', summary: /cancelled/i.test(o!.text) ? 'Edited the party size and cancelled the booking.' : 'Could not confirm cancellation.' } };
      // Family 2, cross-actor: Oddhound signs up actor B itself and opens exactly actor A's record; the
      // edit page is the neighbouring control.
      case 26: return this.#firstRecordPath ? { name: 'check_cross_actor', args: { path: this.#firstRecordPath, try_controls: ['Cancel booking'] } } : { name: 'observe', args: {} };
      case 27: return this.#firstRecordPath ? { name: 'check_cross_actor', args: { path: `${this.#firstRecordPath}/edit` } } : { name: 'observe', args: {} };
      // Two-account check on a known record: actor B tries to open actor A's own booking.
      case 28: return { name: 'use_actor', args: { actor: 'B' } };
      case 29: return { name: 'navigate', args: { path: this.#registerPath } };
      case 30: return { name: 'create_identity', args: {} };
      case 31: {
        const ident = lastToolJson(messages, 'credential_ref');
        const name = find(o!.els, 'input', /name/i), email = find(o!.els, 'input', /e-?mail/i), pass = find(o!.els, 'input', /password/i), submit = find(o!.els, 'button', /create|sign up|register/i);
        if (!ident || !name || !email || !pass || !submit) return { name: 'observe', args: {} };
        this.#queue.push(
          { name: 'fill', args: { ref: email.ref, value: ident.email } },
          { name: 'fill_credential', args: { ref: pass.ref, credential_ref: ident.credential_ref, field: 'password' } },
          { name: 'click', args: { ref: submit.ref } },
        );
        return { name: 'fill', args: { ref: name.ref, value: ident.name } };
      }
      case 32: return this.#firstRecordPath ? { name: 'navigate', args: { path: this.#firstRecordPath } } : { name: 'observe', args: {} };
      case 33: {
        const sawRecord = /Ada Tester/.test(o!.text);
        if (sawRecord) {
          return { name: 'report_candidate', args: {
            title: "A second account can open another account's booking", rule_id: 'R4', impact: 'high',
            observed: `Signed in as a different new account, ${this.#firstRecordPath} showed actor A's booking details.`,
            scenario: { kind: 'cross_account_read', device: 'desktop', auth: this.#auth(), create: { path: this.#formPath, fields: this.#bookingFields({ guest: 'Private {marker}', party: '2', date: '{date+7}', notes: '{marker}' }), submit: this.#bookingSubmit }, listPath: this.#listPath, expectation: 'denied' },
          } };
        }
        return { name: 'observe', args: {} };
      }
      case 34: return { name: 'use_actor', args: { actor: 'A' } };
      case 35: return { name: 'set_device', args: { device: 'mobile' } };
      case 36: return { name: 'navigate', args: { path: this.#formPath } };
      case 37: return { name: 'scroll', args: { to: 'bottom' } };
      case 38: {
        const submit = find(o!.els, 'button', /book|reserve|submit/i);
        if (submit && /COVERED_BY|offscreen/.test(submit.attrs)) {
          return { name: 'report_candidate', args: {
            title: 'On a phone the Book button is covered and cannot be pressed', rule_id: 'R5', impact: 'high',
            observed: `At 390x844, scrolled to the end of the booking form, the submit button is ${submit.attrs.includes('COVERED_BY') ? 'covered by another element' : 'off screen'}.`,
            scenario: { kind: 'mobile_reachability', device: 'mobile', auth: this.#auth(), path: this.#formPath, control: submit.label, expectation: 'reachable' },
          } };
        }
        return { name: 'observe', args: {} };
      }
      case 39: return { name: 'update_workflow', args: { name: 'Mobile booking form', status: 'completed', summary: 'Checked the booking form at 390x844.' } };
      case 40: return { name: 'set_device', args: { device: 'desktop' } };
      // Family 4: fill the booking form without submitting; Oddhound presses Book table twice and counts.
      case 41: return { name: 'navigate', args: { path: this.#formPath } };
      case 42: {
        const guest = find(o!.els, 'input', /guest|name/i), party = find(o!.els, 'input', /party|guests|size|people/i), day = find(o!.els, 'input', /date|day/i);
        const submit = find(o!.els, 'button', /book|reserve|save|submit/i);
        if (!guest || !party || !day || !submit) return { name: 'observe', args: {} };
        this.#queue.push(
          { name: 'fill', args: { ref: party.ref, value: '2' } },
          { name: 'fill', args: { ref: day.ref, value: date(9) } },
          { name: 'check_interruption', args: { kind: 'double_submit', submit: submit.label, field: guest.label, list_path: this.#listPath, rule_id: 'R9' } },
        );
        return { name: 'fill', args: { ref: guest.ref, value: 'Double Press Guest K4' } };
      }
      default:
        return { name: 'finish_run', args: { summary: 'Registered, booked, edited and cancelled; tried boundary values, blank input, a past date, a second account and a phone-sized screen.' } };
    }
  }
}
