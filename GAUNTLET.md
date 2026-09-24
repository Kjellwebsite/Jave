# GAUNTLET

Live state of the JAVE v0.1 build. A phase is marked `[✓]` only when its tests pass.

Legend: `[ ]` not started · `[~]` in progress · `[✓]` passed · `[!]` blocked · `[×]` failed

## Environment notes

- `discord.com` is **blocked by this build environment's egress policy**. The bot
  cannot connect to the real gateway here. Discord behaviour is verified through a
  simulated interaction harness and payload validation. Live connection is a
  deployment-time step (see DEPLOYMENT.md).
- PostgreSQL 16 is available locally; migrations are verified against it.

## Phases

| # | Phase | Status | Tests |
| - | ----- | ------ | ----- |
| 0 | Repository intelligence | [✓] | Repo was empty (no commits, no assets). Greenfield. |
| 1 | Architecture | [~] | Monorepo, schema, core kernel in place |
