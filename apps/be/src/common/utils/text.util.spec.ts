import { cleanName, stripControlChars } from './text.util';

describe('text utils', () => {
  it('strips control characters and keeps normal text', () => {
    expect(stripControlChars('Ad\u0000a\n\t\u001b[31m\u007f\u0085')).toBe('Ada[31m');
    expect(stripControlChars('Nguyễn Văn A 👩‍💻')).toBe('Nguyễn Văn A 👩‍💻');
  });

  it('cleans then trims names, and leaves non-strings alone', () => {
    expect(cleanName({ value: '  \u0007Ada \r\n' })).toBe('Ada');
    expect(cleanName({ value: '\u0000\u0001' })).toBe('');
    expect(cleanName({ value: 5 })).toBe(5);
  });
});
