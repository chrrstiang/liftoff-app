# backend — NestJS API

Run every command from `backend/`. See the root `CLAUDE.md` for product context and the frontend↔backend data split.

## Stack

NestJS 11 on Express · TypeScript (**not** strict) · Node 20 · Jest 30 + supertest · **Drizzle** on RDS Postgres · Supabase JS (**auth only**)

Serves `PORT || 8000` on `HOST || 0.0.0.0` (`src/main.ts`).

## Commands

```bash
npm run start:dev                          # nest start --watch
npm run build                              # → dist/
npm test                                   # unit tests
npm test -- -t "test name"                 # single test
npx jest src/users/service/users.service.spec.ts
E2E_ALLOW_LIVE=1 npm run test:e2e          # ⚠️ hits real remote Supabase
E2E_ALLOW_LIVE=1 npm run e2e:sweep         # remove leaked e2e artifacts
E2E_ALLOW_LIVE=1 npm run e2e:sweep -- --all  # ignore the 30-min age guard
npx eslint "{src,apps,libs,test}/**/*.ts"  # read-only lint
npm run lint                               # ⚠️ eslint --fix, MUTATES FILES
npm run format                             # prettier --write
npx tsc --noEmit                           # typecheck (no npm script exists)
```

## Module layout

Copy this shape for any new feature. `users/` is the only real module:

```
src/
  main.ts, app.module.ts, app.controller.ts, app.service.ts
  supabase/           supabase.module.ts, supabase.service.ts
  users/
    users.module.ts
    controller/       users.controller.ts + athlete/ + coach/
    service/          users.service.ts   + athlete/ + coach/
    dto/              create-user.dto.ts, update-user.dto.ts + athlete/ + coach/
    entities/         UserData.ts, AthleteData.ts, CoachData.ts
  common/
    exceptions/       missing-id.ts, not-unique.ts
    filters/          global-exception-filter.ts        ← registered globally in main.ts
    types/            request.interface.ts, select.queries.ts
    validation/       decorators/ guards/ pipes/ validators/
```

Controllers stay thin: `@UseGuards(JwtAuthGuard)` **per route** (not class-level), explicit `@HttpCode(...)`, `@Body() dto`, `@Req() req: RequestWithUser`, delegate to the service, return `{ message: '...' }`. Constructor DI with `private readonly`.

## Database access

**Data lives in RDS Postgres, reached through Drizzle. Supabase is auth only.**

```ts
constructor(@Inject(DRIZZLE) private readonly db: Database) {}

await this.db.update(users).set(patch).where(eq(users.id, user.id));
```

`DbModule` is `@Global`, so `DRIZZLE` is injectable anywhere without importing it. It takes `DATABASE_URL` locally (what `drizzle-kit` reads) or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` in ECS — the second form exists because RDS manages the master password itself in Secrets Manager, so there is no URL to assemble without writing the secret down somewhere.

⚠️ **There is no RLS. The API is the entire trust boundary.** Nothing in the database will stop a query from reading or writing another user's rows. Every query must scope itself — `eq(users.id, user.id)` or a walk up the ownership chain — and the correctness of that is entirely on the code here. Getting one wrong is a data breach, not a bug.

**Still on Supabase, deliberately:** `JwtAuthGuard` (it verifies tokens, which is auth) and `AthleteService` (the `?data=` compiler, not yet ported).

Local database:

```bash
npm run db:up && npm run db:migrate && npm run db:seed
npm run db:verify   # 18 assertions that the port is sound
```

## Validation and error handling

`src/main.ts` registers three things:

```ts
useContainer(app.select(AppModule), { fallbackOnErrors: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.useGlobalFilters(new GlobalExceptionFilter());
```

Consequences:
- An undeclared body field is a **400**, not ignored. New request fields require a DTO change.
- **Every** error response has the shape `{ statusCode, message, timestamp, path, method }`.
- Non-`HttpException` throws are logged server-side and masked as a generic 500, so internal details never reach the client.

`message` is whichever is more informative: for `ValidationPipe` failures it's the **array** of per-field messages, for manually thrown exceptions it's the string. The filter reads `exception.getResponse()` rather than `exception.message` to achieve that — `exception.message` for a validation error is just `"Bad Request Exception"`, which is why the naive version of this filter silently destroys validation detail. `global-exception-filter.spec.ts` pins that behavior; don't "simplify" it back.

**DTO validation** uses `class-validator`, including DB-backed async validators that inject `SupabaseService` via `ValidatorsModule`:

- `@IsUnique('users', 'username')`
- `@ValueExists(table, column)`

The `useContainer` call above is *what makes that DI work*. **Any new e2e bootstrap must repeat it**, or these validators silently fail. DTOs inherit: `CreateUserDto` → `CreateAthleteDto` / `CreateCoachDto`; `UpdateUserDto extends PartialType(CreateUserDto)`.

**Deliberately NOT registered**: `common/validation/pipes/exception-factory.ts` (`validationExceptionFactory`) and its `exception-mappings.ts`. They map constraint keys like `username.isUnique` to friendlier single messages, but the factory only ever inspects `errors[0]` — so a form with six empty fields would report one error instead of six. Registering it is a deliberate product tradeoff, not a cleanup. The mappings also reference properties no DTO has (`email`, `password`, `age`, `phone`).

Custom exceptions live in `common/exceptions/` with the suffix dropped from the filename: `missing-id.ts` → `MissingIdException extends NotFoundException`, `not-unique.ts` → `NotUniqueException extends BadRequestException`.

## Writes that span tables

`UsersService.createUserProfile` touches `users`, `athletes` and `coaches`, and now runs in a **real transaction** — `db.transaction(async (tx) => ...)`. A failure anywhere rolls everything back.

The previous version hand-rolled compensating deletes, tracking `insertedTables` and reversing them on failure. That existed *only* because supabase-js has no transaction API; it narrowed the window for a half-created profile but could not close it. Do not reintroduce that pattern — use a transaction.

Two things that stay:

1. **Cross-field validation runs before the transaction opens.** These are reads, and a clean 400 beats an aborted transaction.
2. **`createUserProfile` INSERTs the users row, it does not update it.** On Supabase a trigger on `auth.users` created `public.users` at signup and copied the email; that trigger does not exist in RDS, and there is no foreign key between the two databases. The id and email come from the verified JWT, never the body.

## The sparse-fieldset `?data=` pattern

`GET /athlete/profile/:id?data=a,b,c` compiles a caller-supplied field list into a Supabase select string. Three allowlists in `common/types/select.queries.ts` govern it:

| Query form | Example | Allowlist |
|---|---|---|
| direct column | `federation_id` | `VALID_ATHLETES_COLUMNS_QUERIES` |
| nested field | `users.username` | `VALID_TABLE_FIELDS` |
| full table | `federations` → `federations (*)` | `VALID_FULL_TABLE_QUERIES` |

Anything off-allowlist throws `BadRequestException`. `PUBLIC_PROFILE_QUERY` is the default when no `data` is given, and `cleanDataArray` dedupes and drops nested fields made redundant by a requested full table.

⚠️ **These allowlists are a security boundary, not an oversight.** Given the service-role key, they're the only thing constraining what this endpoint will return. Two exclusions are deliberate and documented in the source: `user_id` is omitted because it maps to `auth.uid()`, and `users` is limited to five columns. Do not widen either to make a query convenient.

## Testing

**Unit** — `npm test`. Config is inline in `package.json` under `"jest"`: `rootDir: src`, `testRegex: .*\.spec\.ts$`, specs colocated next to sources. Supabase is mocked via `@nestjs/testing` provider overrides, so no DB and no server needed.

**E2E** — `npm run test:e2e`, config `test/jest-e2e.json`. Uses supertest against an in-process app (`app.getHttpServer()`), so no separate server process — **but it requires real Supabase credentials**, because `SupabaseService` throws at construction when env is missing.

⚠️ **E2E is not hermetic. It mutates the live project real users are in.** There is no staging project and no local database — that is a recorded tradeoff, not an oversight. `test/helpers/fixtures.ts` is what makes it survivable, and **all fixture work must go through it**:

- **`requireLiveOptIn()`** — the suite refuses to run without `E2E_ALLOW_LIVE=1`. CI sets it; locally you type it. That is the point.
- **Never call `signUp`/`signInWithPassword` on `SupabaseService.getClient()`.** supabase-js resolves the PostgREST header as `session?.access_token ?? supabaseKey`, so a session on that client silently downgrades every subsequent query from `service_role` to that user. `users.e2e-spec.ts` did this: four of its tests were asserting `authenticated` behaviour while claiming to test the service-role path, and its cleanup DELETEs hit RLS and affected zero rows — which returns **no error**, so the `try/catch` never fired and rows leaked every run. Use `createTestUser`, which creates via `auth.admin.createUser` and mints tokens on a throwaway client.
- **Everything is prefixed** — `e2e-<runId>-<n>@example.com` and `e2e_<runId>_<n>`, plus `first_name: 'E2E'` / `last_name: <runId>`. The run id is short base36 because `CreateUserDto` caps username at 30 chars and only allows `[a-z0-9._]`. Never use a deliverable email domain; the old fixture minted `@gmail.com`, which would bounce against the project's SMTP reputation once email confirmation is on.
- **`globalTeardown` sweeps by prefix**, because `afterEach` structurally cannot clean up a run that crashed or was killed. CI also runs the sweeper with `if: always()`.
- **`maxWorkers: 1`** in `test/jest-e2e.json`. Spec files used to run in parallel processes mutating live data; at ~20 specs that also trips Supabase's auth signup rate limit, which presents as flaky red CI that looks like a code bug.
- **Look reference data up at runtime** via `findReferenceData`. `users.e2e-spec.ts` hardcoded federation/division/weight-class UUIDs, which pinned CI to specific production rows — reference data could never be reseeded, and CI could never be fixed by deleting rows real users point at.

Adding a table to a spec means adding it to `DIRECT_USER_REFERENCES` in `fixtures.ts`, or its rows leak.

⚠️ **A green `backend-e2e` job does not mean e2e passed.** The job checks for the `SUPABASE_PROJECT_URL` / `SUPABASE_SECRET_KEY` repository secrets first and skips its remaining steps if either is absent, emitting a workflow warning. Without that gate every spec fails identically at `SupabaseService` construction and the job is permanently red, which is worse than no signal. Open the run and look for the "E2E skipped" warning before trusting the check mark.

Two things to follow when adding a spec:

- **Use `test/helpers/fixtures.ts`** for user creation, token minting, reference lookup, and teardown. Both specs now do; don't hand-roll a fixture.
- **Mirror `main.ts` exactly** — the same `ValidationPipe` options *and* `app.useGlobalFilters(new GlobalExceptionFilter())`. Both existing specs do. Drift here means asserting against an error shape production doesn't return.

## Conventions

- **Imports are absolute from `src/...`** — no `@/` alias here (that's the frontend). This works via `baseUrl: "./"` with no `paths`, mirrored by `moduleNameMapper` in both Jest configs. Same-feature imports stay relative (`../service/users.service`).
- `RequestWithUser` must be imported with **`import type`** so Nest's decorator metadata doesn't choke on it.
- Single quotes, trailing commas, `printWidth: 100`, 2-space tabs (`.prettierrc`).
- ESLint is `recommendedTypeChecked`, but loosened: `no-explicit-any` **off**, `no-console` **off**, and `no-unsafe-*` / `no-unused-vars` downgraded to `warn` (`_`-prefixed args and vars are ignored). `prettier/prettier` is an **error**, so formatting breaks the build.
- TS is **not strict**: `strictNullChecks: true` but `noImplicitAny: false`, and no `"strict": true`. Don't assume frontend-level safety.
- JSDoc `/** ... */` with `@param`/`@returns` on non-obvious methods.

## Environment

`backend/.env` (gitignored; copy `backend/.env.example`):

- `SUPABASE_PROJECT_URL`
- `SUPABASE_SECRET_KEY` — the **service-role** key. Bypasses RLS. Never log it, never move it into anything `EXPO_PUBLIC_*`.
- `PORT` (default 8000), `HOST` (default `0.0.0.0`), `NODE_ENV`
- `E2E_ALLOW_LIVE` — **not** read by the app. Only `test/helpers/fixtures.ts` checks it, and only to refuse running the e2e suite against the live project unless it is exactly `1`. Deliberately not in `.env`: it should be typed per-invocation, not made ambient.

Loaded via `ConfigModule.forRoot({ isGlobal: true })`. `SupabaseService` throws `NotFoundException` at construction if either Supabase var is absent, so **the app won't boot without them** — a fast, obvious failure, unlike the frontend.

## Gotchas

- **`npm run lint` is `eslint --fix` and rewrites your files.** Use `npx eslint "{src,apps,libs,test}/**/*.ts"` to check without mutating. Because CI runs the `--fix` form and discards the result, pure formatting violations *pass* CI and then reappear as local diff noise.
- **Name e2e files `*.e2e-spec.ts`.** `testRegex` is now `\.e2e[-.]spec\.ts$` so both hyphen and dot forms are picked up, but the hyphen form is the convention. (Two specs were silently never running before the regex was widened.)
- **`coach.controller.ts` / `coach.service.ts` are unimplemented Nest CLI scaffolding.** The service returns string literals like `` `This action returns all users` `` and the routes have no guards. Not a pattern to imitate, and not working features.
- `VALID_TABLE_FIELDS.users` also allowlists `email` and `role`, neither of which the app ever writes. `role` in particular looks vestigial — superseded by `is_athlete` / `is_coach`. Both are opt-in via `?data=`; the default `PUBLIC_PROFILE_QUERY` deliberately omits them so it can't fail on a missing column. Verify against the live schema before relying on either.
- File naming is genuinely inconsistent — `entities/` is PascalCase (`UserData.ts`) while everything else is kebab-case, and specs mix `users.controller.spec.ts` with `athlete-controller.spec.ts`. **Match the nearest sibling file** rather than inventing a house style or mass-renaming.
- `PATCH /athlete/profile` does **not** exist, though `UpdateAthleteDto` (name-based `federation` / `division` / `weight_class`) is written and unused — it's the shape a future endpoint was meant to take. See `docs/ARCHITECTURE.md`.
- `README.md` in this directory is unmodified NestJS boilerplate — ignore it.
