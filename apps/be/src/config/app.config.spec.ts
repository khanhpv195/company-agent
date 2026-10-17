import { appConfig } from './app.config';

describe('appConfig CORS defaults', () => {
  const saved = { env: process.env.NODE_ENV, cors: process.env.CORS_ORIGINS };
  afterEach(() => {
    process.env.NODE_ENV = saved.env;
    if (saved.cors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = saved.cors;
  });

  it('omits the Vite dev origin by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    const { corsOrigins } = appConfig();
    expect(corsOrigins).not.toContain('http://localhost:1420');
    expect(corsOrigins).toEqual(['tauri://localhost', 'http://tauri.localhost']);
  });

  it('keeps the Vite dev origin outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;
    expect(appConfig().corsOrigins).toContain('http://localhost:1420');
  });

  it('honours an explicit CORS_ORIGINS in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://a.example, https://b.example';
    expect(appConfig().corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});
