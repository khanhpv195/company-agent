import { ConfigType, registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  throttleLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '10', 10),
  throttleTtl: process.env.AUTH_THROTTLE_TTL ?? '60s',
  // Defaults match the argon2 library (64 MiB, 3 passes, 4 lanes).
  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '65536', 10),
    timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '3', 10),
    parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '4', 10),
  },
}));

export type AuthConfig = ConfigType<typeof authConfig>;
