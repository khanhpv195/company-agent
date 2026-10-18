/** Longest reaction key (the column is `varchar(32)`). */
export const REACTION_KEY_MAX = 32;
/** Most distinct emoji one message may carry. */
export const MAX_REACTION_KEYS = 20;

const MODIFIER = '(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])?';
const PICTOGRAM = `\\p{Extended_Pictographic}${MODIFIER}`;
const EMOJI = new RegExp(
  [
    // keycaps: 1️⃣ #️⃣ *️⃣
    '[0-9#*]\\uFE0F?\\u20E3',
    // flags
    '\\p{Regional_Indicator}{2}',
    // a pictogram (skin tone, variation selector), ZWJ sequences, subdivision flags (🏴󠁧󠁢󠁥󠁮󠁧󠁿)
    `${PICTOGRAM}(?:[\\u{E0020}-\\u{E007F}]+|(?:\\u200D${PICTOGRAM})*)`,
  ]
    .map((part) => `(?:${part})`)
    .join('|')
    .replace(/^/, '^(?:')
    .replace(/$/, ')$'),
  'u',
);

/** A single unicode emoji (one glyph, ZWJ sequences and flags allowed), no whitespace, 1..32 characters. */
export const isReactionKey = (key: string): boolean =>
  typeof key === 'string' &&
  key.length > 0 &&
  Array.from(key).length <= REACTION_KEY_MAX &&
  !/\s/u.test(key) &&
  EMOJI.test(key);
