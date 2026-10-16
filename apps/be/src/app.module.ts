import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { appConfig, databaseConfig, envValidationSchema, i18nConfig, I18nConfig } from './config';
import { STATIC_SERVE_ROOT } from './contacts';
import { DatabaseModule } from './database/database.module';
import { TodosModule } from './modules/todos/todos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [appConfig, databaseConfig, i18nConfig],
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
    DatabaseModule,
    TodosModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
