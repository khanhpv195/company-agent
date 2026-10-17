export type Logger = (level: 'info' | 'warn' | 'error', message: string) => void;

export const consoleLogger: Logger = (level, message) => {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  process.stderr.write(`${line}\n`);
};

export const silentLogger: Logger = () => {};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
