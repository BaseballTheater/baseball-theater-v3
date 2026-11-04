---
name: verify
description: Prove the Baseball Theater v3 working tree is healthy with a single exit code. Use after any code change, before declaring a story done, and when a loop/goal asks whether the app works.
---

# Verify

## Single gate (required)

```bash
pnpm verify
```

This is the truth signal. Exit code **0** means:

1. ESLint passes for the whole repo (`pnpm build` runs `pnpm lint` first, so it runs once)
2. Typecheck + package builds succeed (each package's `build` runs `tsc --noEmit`)
3. Vitest passes in all packages **with coverage thresholds**

Exit code **non-zero** means the change is not done. Do not claim success.

### What this covers

| Check                    | How                                                           |
| ------------------------ | ------------------------------------------------------------- |
| Lint                     | `pnpm lint` (first step of `pnpm build`)                      |
| Unit / integration tests | `pnpm test:coverage` (domain, functions, web projects)        |
| Coverage floors          | Per-package Vitest thresholds                                 |
| Types + production build | `pnpm build`                                                  |
| HTTP schedule/game smoke | Covered by `functions/src/handlers/api.test.ts` (fixture API) |

### What this does **not** cover yet

- Visual pitch-animation correctness (manual / future Playwright)
- Cloudflare Workers runtime, Postgres, and Logto adapters (not wired yet; ADR-017–019)
- Live MLB network calls (fixtures only by default)
- Deployed Hosting/Functions health

When a story needs a check beyond `pnpm verify`, add a **named test or script** and put that command in the story’s acceptance criteria. Do not rely on “looks right.”

## Faster local loops (optional)

While iterating inside one package:

```bash
pnpm --filter @bt/domain test
pnpm --filter @bt/functions test
pnpm --filter @bt/web test
pnpm lint
```

Still run **`pnpm verify`** before marking a goal/story complete.

When finishing a backlog story, also set `status: done` in its note `docs/v3/backlog/stories/<ID>.md` and run `pnpm backlog:build` (which regenerates `docs/v3/BACKLOG.md`), then commit the note and `BACKLOG.md` with the code. Verify alone is not enough if the backlog is stale — and `pnpm verify` itself runs `pnpm backlog:check`, so notes edited without a build fail it.

## Capture the run (required to call a story done)

`pnpm verify` prints and forgets. Before committing a finished story, capture the story's grader run and the verify run into the ledger:

```bash
scripts/audit.sh story S14
```

This runs `scripts/verify-S14.sh` and `pnpm verify` for real, appends an entry to `docs/v3/AUDIT.md` listing every check the grader performed with its PASS/FAIL, and prints a summary block for the commit body. Commit the ledger entry **with** the story's code — the entry says the story shipped in "the commit that adds this entry", which is only true if they land together.

Never hand-write a ledger entry. A hand-written entry is indistinguishable from a fabricated one, which is the whole thing the file exists to rule out.

**A grader is a commit-time proof of its own story** (S84): it is expected to pass against the code as of its story's commit, not forever. To re-check a shipped story, `scripts/audit.sh story <ID> --reverify` runs today's grader in a worktree at the story's shipping commit. What must hold on every commit is a law in `docs/v3/LAWS.md`, and `pnpm verify` — this skill's gate — is what enforces it.

Do **not** start another backlog story or `/goal` while the finished story’s changes are still uncommitted — commit first.

## Recipe maintenance

If you discover a new way a change can be “green” on verify but wrong in the product, add:

1. An automated test that fails for that case, **or**
2. A script invoked from `pnpm verify` / story AC

Then update this file with the new step.
