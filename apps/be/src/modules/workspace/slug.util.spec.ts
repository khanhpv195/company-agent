import { slugify } from './slug.util';

describe('slugify', () => {
  it.each([
    ['Khanh workspace', 'khanh-workspace'],
    ['  Hằng & Đức  Team!! ', 'hang-duc-team'],
    ['---', 'workspace'],
    ['', 'workspace'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
