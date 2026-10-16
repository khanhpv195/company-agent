import { ConfigType, registerAs } from '@nestjs/config';
import { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

export const databaseConfig = registerAs('database', () => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'app',
    logging: process.env.DB_LOGGING === 'true',
    // Schema changes must go through migrations in production.
    synchronize: !isProduction && process.env.DB_SYNCHRONIZE === 'true',
  };
});

export type DatabaseConfig = ConfigType<typeof databaseConfig>;

export const buildDataSourceOptions = (config: DatabaseConfig): PostgresDataSourceOptions => ({
  type: 'postgres',
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  database: config.name,
  logging: config.logging,
  synchronize: config.synchronize,
  uuidExtension: 'pgcrypto',
  migrationsTableName: 'migrations',
});
