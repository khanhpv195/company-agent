import { MemberRole } from '@repo/shared';

/** Identity extracted from a verified access token. Set on `req.auth` by `JwtAuthGuard`. */
export interface AuthContext {
  memberId: string;
  workspaceId: string;
  role: MemberRole;
  /** Access token expiry (seconds since the epoch), when the token carries one. */
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
