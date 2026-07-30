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

2. **E2E is excluded.** `npm run test:e2e` hits the real remote Supabase project, creates real auth users, and depends on hardcoded UUIDs — running it mutates shared data. CI runs it only on PRs to `main`. If you specifically need it, say so and run it deliberately.

Report a short pass/fail summary per gate. On failure, show the relevant output and diagnose, but do not fix anything unless asked.
