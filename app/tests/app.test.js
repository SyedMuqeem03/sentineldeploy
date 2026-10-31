const request = require('supertest');

describe('SentinelDeploy API', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    process.env.ENABLE_FAILURE_INJECTION = 'true';
    process.env.FAILURE_MODE = 'normal';
    app = require('../src/app');
  });

  afterEach(() => {
    delete process.env.ENABLE_FAILURE_INJECTION;
    delete process.env.FAILURE_MODE;
  });

  test('GET / returns app metadata', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('SentinelDeploy');
    expect(response.body.version).toBeDefined();
  });

  test('GET /healthz and /readyz work', async () => {
    const health = await request(app).get('/healthz');
    const ready = await request(app).get('/readyz');

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(ready.body.ready).toBe(true);
  });

  test('GET /metrics exposes Prometheus metrics', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('sentineldeploy_http_requests_total');
  });

  test('POST /admin/failure-mode updates test-only failure mode', async () => {
    const response = await request(app)
      .post('/admin/failure-mode')
      .send({ mode: 'high-error-rate' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('high-error-rate');
    expect(response.body.enabled).toBe(true);
  });
});
