/** Plain-text report a user can paste to support. */
export function errorReport(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  return [
    `${e.name}: ${e.message}`,
    e.stack ?? '',
    '',
    `url: ${typeof location === 'undefined' ? '' : location.href}`,
    `time: ${new Date().toISOString()}`,
    `agent: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
  ]
    .join('\n')
    .trim();
}
