import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppController } from '../src/app.controller';
import { configureApp } from '../src/app.setup';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;
  let dbDown = false;
  const fakeDataSource = {
    query: () => (dbDown ? Promise.reject(new Error('connection refused')) : Promise.resolve([])),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: DataSource, useValue: fakeDataSource }],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok with uptime', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', uptime: expect.any(Number) });
  });

  it('GET /api/v1/health/ready answers 200 while the database is up and 503 when it is down', async () => {
    const up = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(up.body).toEqual({ status: 'ok', db: 'up' });

    dbDown = true;
    const down = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(down.body).toEqual({ status: 'unavailable', db: 'down' });
    // Liveness never depends on the database.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    dbDown = false;
  });

  it('unknown routes use the unified error format', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      message: expect.any(String),
      meta: { statusCode: 404, path: '/api/v1/nope' },
    });
  });
});
