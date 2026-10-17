import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { appConfig, AppConfig } from './config';
import { API_PREFIX, DEFAULT_API_VERSION, SWAGGER_PATH } from './contacts';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  const config = app.get<AppConfig>(appConfig.KEY);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    // Lets the desktop app read the request id and rate-limit hints of cross-origin responses.
    exposedHeaders: ['x-request-id', 'retry-after'],
  });

  configureApp(app);
  if (config.swaggerEnabled) setupSwagger(app);

  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API:     http://localhost:${config.port}/${API_PREFIX}/v${DEFAULT_API_VERSION}`);
  if (config.swaggerEnabled) logger.log(`Swagger: http://localhost:${config.port}/${SWAGGER_PATH}`);
}

void bootstrap();
