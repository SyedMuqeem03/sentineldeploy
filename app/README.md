# SentinelDeploy application

This directory contains the Node.js API used for the Milestone 1 self-healing deployment platform implementation.

## Local usage

```bash
npm install
npm test
node app/src/app.js
```

## Docker usage

```bash
docker compose up --build
docker compose down
```

The app exposes `/`, `/healthz`, `/readyz`, `/metrics`, `/api/orders`, and `/admin/failure-mode`.
