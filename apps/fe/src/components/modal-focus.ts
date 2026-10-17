const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** True when the element can receive keyboard focus right now (visible, enabled, not inert). */
export const isFocusable = (el: HTMLElement): boolean => {
  if (el.matches(':disabled')) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) < 0) return false;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[inert]')) return false;
  return el.getClientRects().length > 0;
};

export const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable);

/** Open modals, last = topmost. Only the top one handles Escape and the focus trap. */
const stack: symbol[] = [];
export const modalStack = {
  push: (id: symbol) => void stack.push(id),
  remove: (id: symbol) => {
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
  },
  isTop: (id: symbol) => stack[stack.length - 1] === id,
  size: () => stack.length,
};
