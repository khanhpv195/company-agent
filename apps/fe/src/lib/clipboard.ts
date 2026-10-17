/**
 * Copies text to the clipboard. Falls back to selecting `input` and `execCommand('copy')`
 * when the async Clipboard API is missing or refuses (e.g. an insecure context or a webview).
 * Resolves to false only when both paths fail.
 */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy below.
  }
  return copyBySelection(text, input);
}

/** Selects the field's text and asks the browser to copy the selection. */
export function copyBySelection(text: string, input?: HTMLInputElement | null): boolean {
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  }
}
