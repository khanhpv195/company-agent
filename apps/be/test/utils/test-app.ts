import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export interface TestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
}

/**
 * Boots the full AppModule against the `agent_test` database with the same HTTP
 * pipeline as `main.ts`. Pass `override` to swap providers before compiling.
 */
export const createTestApp = async (
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> => {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) {
    builder = override(builder);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  return { app, dataSource: app.get(DataSource) };
};
