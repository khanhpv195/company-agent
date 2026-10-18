import { mentionedAgents, resolveMentions, type MentionCandidate } from './mentions';

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

describe('resolveMentions', () => {
  const candidates: MentionCandidate[] = [
    { kind: 'agent', id: 'a1', name: 'Bot' },
    { kind: 'member', id: 'm1', name: 'Hằng' },
    { kind: 'member', id: 'm2', name: 'Bot Pro' },
    { kind: 'member', id: 'm3', name: 'Here Kid' },
  ];
  const ids = (text: string) =>
    resolveMentions(text, candidates).targets.map((t) => `${t.kind}:${t.id}`);

  it('resolves members and agents by name in order, longest first', () => {
    expect(ids('hi @hằng and @bot')).toEqual(['member:m1', 'agent:a1']);
    expect(ids('@Bot Pro and @Bot')).toEqual(['member:m2', 'agent:a1']);
  });

  it('detects @here and @room outside of names and addresses', () => {
    expect(resolveMentions('@here look', candidates).here).toBe(true);
    expect(resolveMentions('ping @Room!', candidates).here).toBe(true);
    expect(resolveMentions('mail me@here.com', candidates).here).toBe(false);
    expect(resolveMentions('@hereby', candidates).here).toBe(false);
    expect(resolveMentions('@Here Kid only', candidates)).toMatchObject({ here: false });
  });
});
