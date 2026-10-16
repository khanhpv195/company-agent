import request from 'supertest';
import { createTestApp, TEST_DB_NAME, TestApp, truncateAll } from './utils';

describe('App (e2e, full AppModule on Postgres)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('connects to the test database with migrations applied', async () => {
    const [{ db }] = await ctx.dataSource.query('SELECT current_database() AS db');
    expect(db).toBe(TEST_DB_NAME);
    expect(await ctx.dataSource.showMigrations()).toBe(false);
  });

  it('GET /api/v1/health returns ok', async () => {
    const response = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', uptime: expect.any(Number) });
  });

  it('truncateAll is idempotent', async () => {
    await expect(truncateAll(ctx.dataSource)).resolves.toBeUndefined();
  });
});
