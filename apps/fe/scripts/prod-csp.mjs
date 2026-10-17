// Pure helpers for the production desktop build (no I/O, unit-tested).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Origin (scheme + host + port) of the API URL. Throws a readable Error when the value is not
 * an absolute http(s) URL, or is plain http for a non-local host.
 */
export function apiOrigin(raw) {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new Error(
      'VITE_API_URL is not set. Set it to the public API URL, e.g. https://api.example.com/api/v1',
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_API_URL "${value}" is not an absolute URL (expected https://host/...)`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`VITE_API_URL must use http or https, got "${url.protocol}"`);
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `VITE_API_URL "${value}" must use https (plain http is only allowed for localhost / 127.0.0.1)`,
    );
  }
  return url.origin;
}

/** The production CSP as a Tauri `app.security.csp` directive map. */
export function buildCsp(origin) {
  return {
    'default-src': "'self'",
    'script-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'img-src': "'self' asset: http://asset.localhost data:",
    'style-src': "'self' 'unsafe-inline'",
    'font-src': "'self' data:",
    'connect-src': `'self' ipc: http://ipc.localhost ${origin}`,
  };
}

/** Tauri config override (merged over tauri.conf.json by `tauri build --config`). */
export function buildConfigOverride(rawApiUrl) {
  return { app: { security: { csp: buildCsp(apiOrigin(rawApiUrl)) } } };
}

/** Value of `key` in dotenv text (last wins, optional quotes), or undefined. */
export function readEnvValue(text, key) {
  let found;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] !== key) continue;
    found = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return found;
}
