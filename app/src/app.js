const express = require('express');
const client = require('prom-client');

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_VERSION = process.env.APP_VERSION || 'v0.1.0';
const VALID_FAILURE_MODES = [
  'normal',
  'high-error-rate',
  'high-latency',
  'readiness-failure',
  'crash-loop',
  'dependency-failure',
  'memory-pressure'
];

function buildApp() {
  const app = express();
  const register = new client.Registry();
  client.collectDefaultMetrics({ register, prefix: 'sentineldeploy_' });

  const state = {
    appVersion: DEFAULT_VERSION,
    ready: true,
    failureMode: process.env.FAILURE_MODE || 'normal',
    failureInjectionEnabled: process.env.ENABLE_FAILURE_INJECTION === 'true'
  };

  const httpRequestsTotal = new client.Counter({
    name: 'sentineldeploy_http_requests_total',
    help: 'Total HTTP requests received by the service.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
  });

  const httpErrorsTotal = new client.Counter({
    name: 'sentineldeploy_http_errors_total',
    help: 'Total HTTP 5xx requests received by the service.',
    labelNames: ['method', 'route'],
    registers: [register]
  });

  const requestDurationMs = new client.Histogram({
    name: 'sentineldeploy_request_duration_ms',
    help: 'Distribution of request latencies in milliseconds.',
    labelNames: ['method', 'route'],
    buckets: [5, 25, 50, 100, 250, 500, 1000, 2000, 5000],
    registers: [register]
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    const routePath = req.route && req.route.path ? req.route.path : req.path;

    res.on('finish', () => {
      const elapsedMs = Date.now() - start;
      httpRequestsTotal.inc({
        method: req.method,
        route: routePath,
        status_code: String(res.statusCode)
      });

      if (res.statusCode >= 500) {
        httpErrorsTotal.inc({
          method: req.method,
          route: routePath
        });
      }

      requestDurationMs.observe(
        {
          method: req.method,
          route: routePath
        },
        elapsedMs
      );
    });

    next();
  });

  const setFailureMode = (newMode) => {
    if (!VALID_FAILURE_MODES.includes(newMode)) {
      throw new Error(`Unsupported failure mode: ${newMode}`);
    }

    state.failureMode = newMode;
    state.ready = newMode !== 'readiness-failure';
    return state;
  };

  const injectFailureIfNeeded = (req, res) => {
    const mode = state.failureMode || 'normal';

    if (!state.failureInjectionEnabled || mode === 'normal') {
      return false;
    }

    if (mode === 'high-error-rate') {
      res.status(500).json({
        error: 'High error rate simulated',
        mode,
        request: req.path,
        version: state.appVersion
      });
      return true;
    }

    if (mode === 'high-latency') {
      setTimeout(() => {
        res.status(200).json({
          ok: true,
          delayed: true,
          mode,
          version: state.appVersion,
          message: 'Request completed after latency injection'
        });
      }, 1200);
      return true;
    }

    if (mode === 'readiness-failure') {
      state.ready = false;
      res.status(503).json({
        error: 'Readiness failure injected',
        mode,
        ready: false,
        version: state.appVersion
      });
      return true;
    }

    if (mode === 'dependency-failure') {
      res.status(503).json({
        error: 'Dependency unavailable during failure injection',
        mode,
        version: state.appVersion
      });
      return true;
    }

    if (mode === 'memory-pressure') {
      res.status(503).json({
        error: 'Memory pressure simulated',
        mode,
        version: state.appVersion
      });
      return true;
    }

    if (mode === 'crash-loop') {
      setTimeout(() => {
        process.exit(1);
      }, 100);
      res.status(500).json({
        error: 'Crash loop simulated',
        mode,
        version: state.appVersion
      });
      return true;
    }

    return false;
  };

  app.get('/', (req, res) => {
    res.status(200).json({
      name: 'SentinelDeploy',
      version: state.appVersion,
      status: 'ok',
      ready: state.ready,
      failureMode: state.failureMode,
      failureInjectionEnabled: state.failureInjectionEnabled,
      uptime: process.uptime()
    });
  });

  app.get('/healthz', (req, res) => {
    if (state.failureMode === 'crash-loop') {
      process.exit(1);
    }

    res.status(200).json({
      status: 'ok',
      version: state.appVersion,
      ready: state.ready
    });
  });

  app.get('/readyz', (req, res) => {
    if (state.failureMode === 'readiness-failure' || state.ready === false) {
      res.status(503).json({
        ready: false,
        version: state.appVersion,
        reason: 'Application is not ready'
      });
      return;
    }

    res.status(200).json({
      ready: true,
      version: state.appVersion,
      reason: 'Application is ready'
    });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.get('/api/orders', (req, res) => {
    if (injectFailureIfNeeded(req, res)) {
      return;
    }

    const orderId = `ORD-${Date.now()}`;
    const payload = {
      orderId,
      status: 'processed',
      version: state.appVersion,
      customer: 'demo-customer',
      amount: 42.99
    };

    res.status(200).json(payload);
  });

  app.post('/admin/failure-mode', (req, res) => {
    if (state.failureInjectionEnabled !== true) {
      res.status(403).json({
        error: 'Failure injection is disabled in this environment',
        enabled: false
      });
      return;
    }

    const requestedMode = req.body && req.body.mode ? String(req.body.mode).trim() : 'normal';

    if (!VALID_FAILURE_MODES.includes(requestedMode)) {
      res.status(400).json({
        error: 'Unsupported failure mode',
        validModes: VALID_FAILURE_MODES,
        requestedMode
      });
      return;
    }

    try {
      setFailureMode(requestedMode);
      res.status(200).json({
        mode: requestedMode,
        enabled: true,
        ready: state.ready,
        message: `Failure mode updated to ${requestedMode}`
      });
    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  });

  app.get('/admin/failure-mode', (req, res) => {
    res.status(200).json({
      mode: state.failureMode,
      enabled: state.failureInjectionEnabled,
      ready: state.ready
    });
  });

  return app;
}

const app = buildApp();

if (require.main === module) {
  app.listen(DEFAULT_PORT, () => {
    console.log(`SentinelDeploy app listening on port ${DEFAULT_PORT}`);
  });
}

module.exports = app;
module.exports.buildApp = buildApp;
