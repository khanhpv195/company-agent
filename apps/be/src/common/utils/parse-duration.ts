const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Parses `30s | 15m | 12h | 30d` into milliseconds. Throws on anything else. */
export const parseDuration = (value: string): number => {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}", expected <number>[s|m|h|d] such as 15m or 30d`);
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
};
