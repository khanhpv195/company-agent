import { SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@repo/shared';
import { ROLES_KEY } from '../../contacts';

/** Restricts a handler/controller to these roles (enforced by `RolesGuard`, after the JWT guard). */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
