import { isReactionKey } from './reaction-key';

describe('isReactionKey', () => {
  it.each(['👍', '❤️', '🎉', '👍🏽', '👨‍👩‍👧', '🇻🇳', '1️⃣', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'])('accepts %s', (key) => {
    expect(isReactionKey(key)).toBe(true);
  });

  it.each(['', 'a', 'abc', '#', '1', '👍 ', ' 👍', '👍👍', '🙂x', 'x🙂', '👍\n', '<b>'])(
    'rejects %j',
    (key) => {
      expect(isReactionKey(key)).toBe(false);
    },
  );

  it('rejects more than 32 characters', () => {
    expect(isReactionKey(Array.from({ length: 17 }, () => '👍‍👍').join(''))).toBe(false);
  });
});
