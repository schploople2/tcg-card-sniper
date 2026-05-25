# server

Express + Prisma JSON API for TCG Card Sniper. Hosts every background cron (listing refresh, lot auto-OCR, saved-search refresh, daily price snapshot, weekly catalog sync).

## Dev loop

```bash
pnpm install                            # from repo root
pnpm --filter server dev                # tsx watch on src/index.ts, port 3001
pnpm --filter server test               # vitest, ~290 tests
pnpm --filter server build              # strict tsc → dist/
```

Healthcheck: `GET /api/health`.

## Layout

```
src/
├── index.ts          App bootstrap — mounts routers, starts crons
├── config.ts         Zod-validated env loader
├── db.ts             Prisma client singleton
├── routes/           One file per JSON resource
├── services/         Business logic — see __tests__/ for the patterns
├── jobs/             node-cron workers
└── middleware/       Auth (JWT) + global error handler
```

## Env vars

See the root [README.md](../README.md#environment-variables) for the full table. Set them in `server/.env` for local dev; Railway env vars take over in prod.

## Tests

`vitest run` from this directory (or `pnpm --filter server test` from root). Prisma + axios + Anthropic SDK are mocked at the module boundary using `vi.hoisted` + `vi.mock`. See [docs/TESTING.md](../docs/TESTING.md) for the conventions.
