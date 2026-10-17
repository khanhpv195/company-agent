import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../contacts';

/** Skips `JwtAuthGuard` for this handler/controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
