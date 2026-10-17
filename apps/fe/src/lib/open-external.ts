const ALWAYS_ALLOWED = new Set(['https:', 'mailto:']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * True for an absolute URL that may be opened: https and mailto everywhere, plus plain http
 * only for localhost / 127.0.0.1 in a web context (dev). Anything else is never opened.
 */
export function isOpenableUrl(url: string, tauri: boolean = inTauri()): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (ALWAYS_ALLOWED.has(parsed.protocol)) return true;
  return !tauri && parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
}

/** Opens a link in the system browser (desktop) or a new tab (web). */
export function openExternal(url: string): void {
  if (!isOpenableUrl(url)) return;
  if (inTauri()) {
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** Click handler for `<a href>` that routes the link through `openExternal`. */
export function onExternalLinkClick(e: { preventDefault(): void }, url: string): void {
  e.preventDefault();
  openExternal(url);
}
