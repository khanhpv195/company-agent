import { parseDuration } from './parse-duration';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['30d', 2_592_000_000],
    [' 1d ', 86_400_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '1.5h', '-1m', '10w', '1 m', 'abc'])('rejects "%s"', (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });
});
