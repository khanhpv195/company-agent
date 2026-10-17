const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

/**
 * The agents `@name`-mentioned in a text, in order of first mention. Case-insensitive; names are
 * matched longest first so "@Bot Pro" wakes "Bot Pro" only (not "Bot"), and a name must end at a
 * word boundary ("@Bots" does not mention "Bot") and the "@" must not follow a word character
 * ("foo@Bot.com" is an address). Text and names are NFC-normalized before folding case.
 */
export const mentionedAgents = <T extends { name: string }>(text: string, agents: T[]): T[] => {
  const lower = text.normalize('NFC').toLowerCase();
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  const claimed: Array<[number, number]> = [];
  const hits: Array<{ index: number; agent: T }> = [];
  for (const agent of byLength) {
    const needle = `@${agent.name.normalize('NFC').trim().toLowerCase()}`;
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
      hits.push({ index, agent });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<T>();
  const result: T[] = [];
  for (const { agent } of hits) {
    if (seen.has(agent)) continue;
    seen.add(agent);
    result.push(agent);
  }
  return result;
};
