import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { ClockModule } from './common/clock';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { parseDuration } from './common/utils';
import {
  agentConfig,
  appConfig,
  authConfig,
  AuthConfig,
  databaseConfig,
  envValidationSchema,
  i18nConfig,
  I18nConfig,
} from './config';
import { STATIC_SERVE_ROOT } from './contacts';
import { DatabaseModule } from './database/database.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { ComputersModule } from './modules/computers/computers.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { DaemonModule } from './modules/daemon/daemon.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EventsModule } from './modules/events';
import { GatewayModule } from './modules/gateway/gateway.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SimulatorModule } from './modules/simulator/simulator.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [appConfig, databaseConfig, i18nConfig, authConfig, agentConfig],
      validationSchema: envValidationSchema,
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
    // Limits only apply where ThrottlerGuard is used (the auth controller).
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [authConfig.KEY],
      useFactory: (config: AuthConfig) => ({
        throttlers: [{ limit: config.throttleLimit, ttl: parseDuration(config.throttleTtl) }],
      }),
    }),
    // maxListeners 0: every open SSE stream registers one `realtime` listener.
    EventEmitterModule.forRoot({ maxListeners: 0 }),
    ScheduleModule.forRoot(),
    ClockModule,
    EventsModule,
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    ComputersModule,
    AgentsModule,
    GatewayModule,
    DaemonModule,
    OnboardingModule,
    TasksModule,
    ChatModule,
    DashboardModule,
    ConnectionsModule,
    SimulatorModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
