import { deriveAgentStatus } from './agent-status.util';

describe('deriveAgentStatus', () => {
  it.each([
    ['offline', false, 'offline'],
    ['offline', true, 'offline'],
    ['sleeping', true, 'offline'],
    ['sleeping', false, 'offline'],
    ['online', true, 'working'],
    ['online', false, 'idle'],
  ] as const)('computer %s, busy %s -> %s', (computer, busy, expected) => {
    expect(deriveAgentStatus(computer, busy)).toBe(expected);
  });
});
