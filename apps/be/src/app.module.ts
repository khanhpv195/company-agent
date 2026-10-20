import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { ClockModule } from './common/clock';
import { ApiThrottlerGuard, JwtAuthGuard, RolesGuard } from './common/guards';
import { THROTTLER_API, THROTTLER_GATEWAY } from './common/guards/auth-throttler.guard';
import { buildLoggerParams } from './common/logging';
import { parseDuration } from './common/utils';
import {
  agentConfig,
  appConfig,
  authConfig,
  AuthConfig,
  billingConfig,
  databaseConfig,
  envValidationSchema,
  i18nConfig,
  I18nConfig,
  mailConfig,
  opsConfig,
  OpsConfig,
} from './config';
import { STATIC_SERVE_ROOT } from './contacts';
import { DatabaseModule } from './database/database.module';
import { AccountModule } from './modules/account/account.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChatModule } from './modules/chat/chat.module';
import { ComputersModule } from './modules/computers/computers.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { DaemonModule } from './modules/daemon/daemon.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EventsModule } from './modules/events';
import { GatewayModule } from './modules/gateway/gateway.module';
import { MailModule } from './modules/mail/mail.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RetentionModule } from './modules/retention/retention.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamModule } from './modules/team/team.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';

const API_THROTTLE_TTL_MS = 60_000;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [
        appConfig,
        databaseConfig,
        i18nConfig,
        authConfig,
        agentConfig,
        mailConfig,
        billingConfig,
        opsConfig,
      ],
      validationSchema: envValidationSchema,
    }),
    // JSON request logs with a request id; `app.useLogger` in main.ts routes Nest logs here too.
    LoggerModule.forRootAsync({
      imports: [],
      inject: [opsConfig.KEY],
      useFactory: (ops: OpsConfig) =>
        buildLoggerParams({ level: ops.logLevel, pretty: process.env.NODE_ENV === 'development' }),
    }),
    I18nModule.forRootAsync({
      // nestjs-i18n 10 types deep-import `@nestjs/common/interfaces`, which the
      // ESM-only Nest 12 package no longer exposes, so `imports` reads as required.
      imports: [],
      inject: [i18nConfig.KEY],
      useFactory: (config: I18nConfig) => ({
        fallbackLanguage: config.fallbackLanguage,
        loaderOptions: { path: join(__dirname, 'i18n'), watch: false },
      }),
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        new HeaderResolver(['x-lang']),
        AcceptLanguageResolver,
      ],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: STATIC_SERVE_ROOT,
    }),
    // The guard injects JwtService; keep it resolvable outside AuthModule.
    JwtModule.register({ global: true }),
    // Three throttlers, each applied only by its own guard (see `AuthThrottlerGuard`):
    // `default` = auth routes, `api` = global per member/IP, `gateway` = per computer.
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [authConfig.KEY, opsConfig.KEY],
      useFactory: (auth: AuthConfig, ops: OpsConfig) => ({
        throttlers: [
          { limit: auth.throttleLimit, ttl: parseDuration(auth.throttleTtl) },
          { name: THROTTLER_API, limit: ops.apiThrottleLimit, ttl: API_THROTTLE_TTL_MS },
          { name: THROTTLER_GATEWAY, limit: ops.gatewayThrottleLimit, ttl: API_THROTTLE_TTL_MS },
        ],
      }),
    }),
    // maxListeners 0: every open SSE stream registers one `realtime` listener.
    EventEmitterModule.forRoot({ maxListeners: 0 }),
    ScheduleModule.forRoot(),
    ClockModule,
    EventsModule,
    DatabaseModule,
    MailModule,
    AuditModule,
    WorkspaceModule,
    AuthModule,
    AccountModule,
    TeamModule,
    BillingModule,
    ComputersModule,
    AgentsModule,
    GatewayModule,
    DaemonModule,
    OnboardingModule,
    TasksModule,
    ChatModule,
    DepartmentsModule,
    DashboardModule,
    ConnectionsModule,
    SimulatorModule,
    RetentionModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class AppModule {}
