# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ccf33ec3 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Project

Pokémon card deal-finder. Express/Prisma/Postgres server hosting cron-driven eBay listing refresh + Anthropic Vision lot OCR + multi-channel alerts (in-app bell, Discord webhooks, web push). React/Vite client. Deployed on Railway as two services (`server`, `client`).

## Where to look

- **[README.md](README.md)** — start here: pitch, env vars, quick start, project layout
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — services, data model, jobs, alert pipeline
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Railway specifics + recurring gotchas
- **[docs/TESTING.md](docs/TESTING.md)** — server/component/e2e layers + how to run each
- **[docs/features/](docs/features/)** — one doc per shipped feature, named `<bead-id>-<slug>.md`

## Build & test

```bash
pnpm install
pnpm dev                           # server + client in parallel
pnpm --filter server test          # vitest, ~290 tests
pnpm --filter client test          # vitest + RTL, ~34 tests
pnpm --filter client test:e2e      # Playwright (needs PW_USER/PW_PASS)
pnpm --filter server build && pnpm --filter client build
```

## Conventions worth knowing

- **Beads, not TodoWrite.** All task tracking lives in `bd`. Use `bd create` / `bd update --claim` / `bd close`. See the integration block above.
- **Every feature bead requires a `docs/features/<id>-*.md` doc AND a hands-on test before `bd close`.** Convention saved in user memory.
- **Server auto-deploys** from `main` on git push. **Client is manual:** `RAILWAY_CALLER=... railway up ./client --path-as-root --service client`. Don't try to wire client auto-deploy without reading [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) first.
- **Node ≥20** is required (see `engines` in root `package.json`). `cheerio` → `undici@7` references the Node-20 `File` global — Node 18 hard-crashes on require. `NIXPACKS_NODE_VERSION=20` is set on Railway as a backstop.
- **Prisma + manual trigram indexes:** `Card.name_trgm_idx` and `Card.setName_trgm_idx` are created via raw SQL (Prisma can't model them). Every generated migration tries to `DROP` them — **strip those `DROP INDEX` statements before applying.** We've hit this twice.
- **Sold-comp scrapes go through ScrapingBee** (set `SCRAPINGBEE_API_KEY`). Direct eBay scraping from datacenter IPs 403s. See [docs/features/l6x-sold-comps.md](docs/features/l6x-sold-comps.md).
- **Tests live next to code:** `server/src/services/__tests__/*.test.ts` for server, `client/src/components/shared/__tests__/*.test.tsx` for client, `client/e2e/*.spec.ts` for Playwright.
