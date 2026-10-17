import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { i18nValidationErrorFactory } from 'nestjs-i18n';
import { AllExceptionsFilter } from './common/filters';
import { LoggingInterceptor, TransformResponseInterceptor } from './common/interceptors';
import { API_PREFIX, DEFAULT_API_VERSION, SWAGGER_PATH, SupportedLanguage } from './contacts';

/** Global HTTP pipeline shared by `main.ts` and the e2e tests. */
export const configureApp = (app: INestApplication): void => {
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
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformResponseInterceptor(app.get(Reflector)),
  );
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
