import { ConfigType, registerAs } from '@nestjs/config';

export type ConnectionsMode = 'simulated' | 'disabled';

/** Logging, global rate limits, provider connections and retention (production operations). */
export const opsConfig = registerAs('ops', () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    logLevel: process.env.LOG_LEVEL ?? 'info',
    apiThrottleLimit: parseInt(process.env.API_THROTTLE_LIMIT ?? '600', 10),
    gatewayThrottleLimit: parseInt(process.env.GATEWAY_THROTTLE_LIMIT ?? '1200', 10),
    connectionsMode: (process.env.CONNECTIONS_MODE ??
      (isProduction ? 'disabled' : 'simulated')) as ConnectionsMode,
    retentionEnabled: process.env.RETENTION_ENABLED !== 'false',
    auditRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS ?? '365', 10),
  };
});

export type OpsConfig = ConfigType<typeof opsConfig>;
