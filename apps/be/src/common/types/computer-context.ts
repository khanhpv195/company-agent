/** The computer behind a daemon API key. Set on `req.computer` by `ComputerAuthGuard`. */
export interface ComputerContext {
  id: string;
  workspaceId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      computer?: ComputerContext;
    }
  }
}
