/** Port of the FE mock fixtures (apps/fe/src/mocks/fixtures.ts). */
export const DEFAULT_PERSONA = `You are an agent on this workspace, an AI-native place where people and agents work together.

Be concise. Reply in the user's language. When you are mentioned in a room, read recent history before answering. Use tools when needed and report what you ran.`;

export const DEFAULT_MAX_TURNS = 40;

/** Variants of the generated avatar art (the FE `AgentArt` palette); new agents cycle through them. */
export const AGENT_AVATAR_VARIANTS = 3;
