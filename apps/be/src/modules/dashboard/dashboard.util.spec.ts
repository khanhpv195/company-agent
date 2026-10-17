import { lastDays, localDate } from './dashboard.util';

describe('dashboard day helpers', () => {
  it('cuts days in the given timezone, not in UTC', () => {
    // 17:30 UTC is already the next day in Ho Chi Minh City (UTC+7).
    const at = new Date('2026-03-10T17:30:00Z');
    expect(localDate(at, 'UTC')).toBe('2026-03-10');
    expect(localDate(at, 'Asia/Ho_Chi_Minh')).toBe('2026-03-11');
    expect(localDate(new Date('2026-03-10T16:59:59Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-03-10');
  });

  it('lists the last days oldest first across month and year ends', () => {
    expect(lastDays('2026-03-02', 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(lastDays('2026-01-01', 2)).toEqual(['2025-12-31', '2026-01-01']);
    expect(lastDays('2026-03-11', 14)).toHaveLength(14);
  });
});
