const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

interface Hit<T> {
  index: number;
  end: number;
  item: T;
}

/**
 * Finds the `@name` mentions of `items` in a text: case-insensitive, names matched longest first
 * (so "@Bot Pro" does not also mention "Bot"), a name must end at a word boundary and the "@"
 * must not follow a word character ("foo@Bot.com" is an address). Text and names are
 * NFC-normalized before folding case. Earlier items win a span over later ones of equal length.
 */
const scan = <T extends { name: string }>(
  lower: string,
  items: T[],
): { hits: Hit<T>[]; claimed: Array<[number, number]> } => {
  const byLength = [...items].sort((a, b) => b.name.length - a.name.length);
  const claimed: Array<[number, number]> = [];
  const hits: Hit<T>[] = [];
  for (const item of byLength) {
    const needle = `@${item.name.normalize('NFC').trim().toLowerCase()}`;
    if (needle.length < 2) continue;
    for (let from = 0; ;) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      from = index + 1;
      const end = index + needle.length;
      const before = Array.from(lower.slice(Math.max(0, index - 2), index)).pop();
      // "foo@Bot.com" is an address, not a mention.
      if (before !== undefined && WORD_CHAR.test(before)) continue;
      const next = lower.slice(end, end + 2).codePointAt(0);
      if (next !== undefined && WORD_CHAR.test(String.fromCodePoint(next))) continue;
      if (claimed.some(([s, e]) => index < e && end > s)) continue;
      claimed.push([index, end]);
      hits.push({ index, end, item });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return { hits, claimed };
};

const unique = <T>(hits: Hit<T>[]): T[] => {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const { item } of hits) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
};

/** The agents `@name`-mentioned in a text, in order of first mention (see `scan` for the rules). */
export const mentionedAgents = <T extends { name: string }>(text: string, agents: T[]): T[] =>
  unique(scan(text.normalize('NFC').toLowerCase(), agents).hits);

export interface MentionCandidate {
  kind: 'member' | 'agent';
  id: string;
  name: string;
}

export interface ResolvedMentions {
  /** Members and agents, in order of first mention. Agents win a name shared with a member. */
  targets: MentionCandidate[];
  /** `@here` or `@room`: every human of the room. */
  here: boolean;
}

const HERE = /(?<![\p{L}\p{N}\p{M}_])@(?:here|room)(?![\p{L}\p{N}\p{M}_])/gu;

/** Resolves every kind of mention of a text: members and agents by name, plus `@here` / `@room`. */
export const resolveMentions = (text: string, candidates: MentionCandidate[]): ResolvedMentions => {
  const lower = text.normalize('NFC').toLowerCase();
  const { hits, claimed } = scan(lower, candidates);
  let here = false;
  for (const match of lower.matchAll(HERE)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (claimed.some(([s, e]) => index < e && end > s)) continue;
    here = true;
    break;
  }
  return { targets: unique(hits), here };
};
