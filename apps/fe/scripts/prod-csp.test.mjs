import { describe, expect, it } from 'vitest';
import { apiOrigin, buildConfigOverride, buildCsp, readEnvValue } from './prod-csp.mjs';

describe('apiOrigin', () => {
  it('keeps only the origin', () => {
    expect(apiOrigin('https://api.example.com/api/v1')).toBe('https://api.example.com');
    expect(apiOrigin(' https://api.example.com:8443/x ')).toBe('https://api.example.com:8443');
  });
  it('allows http for localhost only', () => {
    expect(apiOrigin('http://localhost:3000/api/v1')).toBe('http://localhost:3000');
    expect(apiOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(() => apiOrigin('http://api.example.com')).toThrow(/https/);
  });
  it('rejects empty, relative and non-http values', () => {
    expect(() => apiOrigin('')).toThrow(/not set/);
    expect(() => apiOrigin(undefined)).toThrow(/not set/);
    expect(() => apiOrigin('/api/v1')).toThrow(/absolute/);
    expect(() => apiOrigin('ftp://x.com')).toThrow(/http or https/);
  });
});

describe('buildCsp', () => {
  it('locks scripts down and allows the API origin', () => {
    const csp = buildCsp('https://api.example.com');
    expect(csp['script-src']).toBe("'self'");
    expect(csp['object-src']).toBe("'none'");
    expect(csp['base-uri']).toBe("'none'");
    expect(csp['connect-src']).toBe("'self' ipc: http://ipc.localhost https://api.example.com");
  });
  it('wraps it in the Tauri config shape', () => {
    expect(buildConfigOverride('https://a.io/v1').app.security.csp['connect-src']).toContain(
      'https://a.io',
    );
  });
});

describe('readEnvValue', () => {
  it('reads plain, quoted and last values', () => {
    const t = 'A=1\nVITE_API_URL="https://x.io/api"\n# c\nVITE_API_URL=https://y.io\n';
    expect(readEnvValue(t, 'VITE_API_URL')).toBe('https://y.io');
    expect(readEnvValue('VITE_API_URL="https://x.io"', 'VITE_API_URL')).toBe('https://x.io');
    expect(readEnvValue(t, 'NOPE')).toBeUndefined();
  });
});
