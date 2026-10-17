import { useEffect, useRef, type ReactNode } from 'react';
import { focusables, isFocusable, modalStack } from './modal-focus';

/**
 * Centered dialog; closes on backdrop click and Escape. Moves focus into the dialog on open
 * (first field, else first control), keeps Tab inside it, and restores focus to the opener on close.
 */
export function Modal({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const id = Symbol('modal');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(id);

    const onKey = (e: KeyboardEvent) => {
      if (!modalStack.isTop(id)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!active || !root.contains(active) || active === root) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!modalStack.isTop(id)) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      (focusables(root)[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);

    if (!root.contains(document.activeElement)) {
      const first =
        Array.from(
          root.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select'),
        ).find(isFocusable) ??
        focusables(root)[0] ??
        root;
      first.focus();
    }
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      modalStack.remove(id);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
