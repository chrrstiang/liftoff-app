---
description: Run the CI gates locally, in the same order CI runs them
---

Reproduce what `.github/workflows/ci.yml` checks, so failures surface before you push.

Run these from the repo root, stopping at the first failure and reporting which gate broke:

**frontend**

```bash
cd frontend && npm run lint && npm run type-check
```

**backend**

```bash
cd backend && npx eslint "{src,apps,libs,test}/**/*.ts" && npx tsc --noEmit && npm run build && npm test
```

Two deliberate deviations from CI, both worth preserving:

1. **Backend lint uses `npx eslint` directly, not `npm run lint`.** The npm script has `--fix` baked in and rewrites source files. CI gets away with that because it discards the working tree; locally it would silently reformat your code mid-review. If the read-only check reports only formatting errors, then run `npm run lint` (or `npm run format`) to fix them intentionally.

2. **E2E is excluded.** It needs a local Postgres running (`npm run db:up && npm run db:migrate && npm run db:seed`) and it creates real auth users on the shared Supabase project, whose signup limit is per-hour and cumulative across CI runs. Table rows are hermetic now — only auth is shared — so the cost is throttling rather than mutating production data. Run it deliberately with `E2E_ALLOW_LIVE=1 npm run test:e2e` when the change touches an endpoint or an ownership rule; CI runs it on PRs to `main` and pushes to `main`.

⚠️ **A green `backend-e2e` in CI does not mean e2e passed.** The job skips its remaining steps with a workflow warning if the Supabase secrets are missing, or if the project doesn't answer at `/auth/v1/health` — a free-tier project pauses after about a week idle. Open the run and look for the "E2E skipped" warning before trusting the check. Note the guard steps' own `echo` lines contain that warning text, so grep the job's *output* for `Tests:` rather than for the warning string.

Report a short pass/fail summary per gate. On failure, show the relevant output and diagnose, but do not fix anything unless asked.
