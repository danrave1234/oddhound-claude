// Why a click did not happen, in words the agent can act on. Playwright only reports "Timeout 5000ms
// exceeded" after waiting, which led the agent to retry the same click again and again. These checks read the
// page (no clicks, no model-supplied code) to say whether the control is disabled or covered by something.
import type { Locator } from 'playwright';

/** Checked before clicking: a disabled control answers at once instead of after the click timeout. */
export async function disabledReason(loc: Locator): Promise<string | null> {
  const off = await loc.evaluate((el) => el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true', undefined, { timeout: 2_000 }).catch(() => false);
  return off ? 'not clicked: the control is disabled on the page right now (if the form is blank or invalid, this is the page refusing it)' : null;
}

/** Checked after a failed click: what sits on top of the control, if anything. */
export async function blockedReason(loc: Locator): Promise<string | null> {
  const why = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'it has no visible size';
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'it is outside the visible window';
    const root = el.getRootNode() as Document | ShadowRoot;
    const top = root.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    const modal = top.closest('dialog, [role=dialog], [role=alertdialog], [aria-modal=true]');
    const box = modal ?? top;
    const byId = box.getAttribute('aria-labelledby');
    const name = box.getAttribute('aria-label') || (byId && document.getElementById(byId)?.textContent) || box.querySelector('h1, h2, h3')?.textContent || top.textContent || '';
    const shown = name.replace(/\s+/g, ' ').trim().slice(0, 60);
    return `another element is on top of it: ${modal ? 'a dialog' : `a <${top.tagName.toLowerCase()}>`}${shown ? ` "${shown}"` : ''}`;
  }, undefined, { timeout: 2_000 }).catch(() => null);
  return why ? `not clicked: ${why}. Close or finish that first, or use the matching control inside it` : null;
}
