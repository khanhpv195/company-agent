import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { i18nValidationErrorFactory } from 'nestjs-i18n';
import { AllExceptionsFilter } from './common/filters';
import { TransformResponseInterceptor } from './common/interceptors';
import { appConfig, type AppConfig } from './config';
import { API_PREFIX, DEFAULT_API_VERSION, SWAGGER_PATH, SupportedLanguage } from './contacts';

const BODY_LIMIT = '2mb';
const BILLING_WEBHOOK_PATH = '/billing/webhook';

const getSettings = (app: INestApplication): AppConfig | undefined => {
  try {
    return app.get<AppConfig>(appConfig.KEY, { strict: false });
  } catch {
    return undefined;
  }
};

/** Global HTTP pipeline shared by `main.ts` and the e2e tests. */
export const configureApp = (app: INestApplication): void => {
  // Daemon results and progress batches carry long agent output: 2 MB instead of Express' 100 kB.
  const express = app as NestExpressApplication;
  // Behind a reverse proxy every request comes from the proxy's address: without this the
  // address-keyed throttlers share one bucket. Never trust X-Forwarded-For when not behind one.
  // (Minimal test modules without ConfigModule keep Express' default: off.)
  const settings = getSettings(app);
  express.set('trust proxy', settings?.trustProxy ?? false);
  // Stripe signs the exact bytes it sent: keep them for the webhook route only.
  // (`verify` reaches body-parser but is missing from Nest's option type.)
  express.useBodyParser('json', {
    limit: BODY_LIMIT,
    verify: (req: { originalUrl?: string; rawBody?: Buffer }, _res: unknown, buffer: Buffer) => {
      if (req.originalUrl?.split('?')[0].endsWith(BILLING_WEBHOOK_PATH)) req.rawBody = buffer;
    },
  } as { limit: string });
  express.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: i18nValidationErrorFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.useGlobalInterceptors(new TransformResponseInterceptor(app.get(Reflector)));
};

export const setupSwagger = (app: INestApplication): void => {
  const config = new DocumentBuilder()
    .setTitle('Backend API')
    .setDescription('NestJS API consumed by the Tauri desktop app')
    .setVersion(DEFAULT_API_VERSION)
    .addBearerAuth()
    .addGlobalParameters({
      in: 'header',
      name: 'Accept-Language',
      required: false,
      schema: { type: 'string', enum: Object.values(SupportedLanguage), default: 'en' },
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
  });
};
