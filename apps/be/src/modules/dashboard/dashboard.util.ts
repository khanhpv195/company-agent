/** `YYYY-MM-DD` of an instant in `timeZone`. */
export const localDate = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** The `count` calendar days ending at `today` (`YYYY-MM-DD`), oldest first. */
export const lastDays = (today: string, count: number): string[] => {
  const [year, month, day] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1, day - (count - 1 - i)));
    return date.toISOString().slice(0, 10);
  });
};
