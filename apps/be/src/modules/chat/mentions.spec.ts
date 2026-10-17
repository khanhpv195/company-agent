import { mentionedAgents } from './mentions';

const agents = ['Bot', 'Bot Pro', "khanh's Claude", 'Hằng'].map((name) => ({ name }));
const names = (text: string) => mentionedAgents(text, agents).map((a) => a.name);

describe('mentionedAgents', () => {
  it('matches case-insensitively, in order of first mention', () => {
    expect(names("hi @KHANH'S claude and @bot")).toEqual(["khanh's Claude", 'Bot']);
    expect(names('@bot @bot @Bot')).toEqual(['Bot']);
  });

  it('prefers the longest name at one position', () => {
    expect(names('@Bot Pro please')).toEqual(['Bot Pro']);
    expect(names('@Bot Pro and @Bot')).toEqual(['Bot Pro', 'Bot']);
  });

  it('needs a word boundary after the name', () => {
    expect(names('@Bots are noisy')).toEqual([]);
    expect(names('@Bot, hello')).toEqual(['Bot']);
    expect(names('@Hằng?')).toEqual(['Hằng']);
    expect(names('@Hằngx')).toEqual([]);
  });

  it('does not treat an address as a mention', () => {
    expect(names('mail foo@Bot.com now')).toEqual([]);
    expect(names('x_@Bot')).toEqual([]);
    expect(names('(@Bot) and "@bot"')).toEqual(['Bot']);
    expect(names('hi\n@Bot')).toEqual(['Bot']);
  });

  it('matches across Unicode normalization forms', () => {
    const nfd = 'hằng'.normalize('NFD');
    expect(nfd).not.toBe('hằng');
    expect(names(`@${nfd} ơi`)).toEqual(['Hằng']);
    const nfdAgents = [{ name: 'Hằng'.normalize('NFD') }];
    expect(mentionedAgents('@HẰNG', nfdAgents)).toHaveLength(1);
  });

  it('ignores text without a mention', () => {
    expect(names('Bot Pro without at')).toEqual([]);
  });
});
