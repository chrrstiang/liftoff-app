# backend — NestJS API

Run every command from `backend/`. See the root `CLAUDE.md` for product context and the frontend↔backend data split.

## Stack

NestJS 11 on Express · TypeScript (**not** strict) · Node 20 · Jest 30 + supertest · Supabase JS (no ORM)

Serves `PORT || 8000` on `HOST || 0.0.0.0` (`src/main.ts`).

## Commands

```bash
npm run start:dev                          # nest start --watch
npm run build                              # → dist/
npm test                                   # unit tests
npm test -- -t "test name"                 # single test
npx jest src/users/service/users.service.spec.ts
npm run test:e2e                           # ⚠️ hits real remote Supabase
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

## Supabase access

No ORM — always `supabaseService.getClient()`, then the query builder:

```ts
const { data, error } = await this.supabase.from('users').update(dto).eq('id', user.id);
if (error) UsersService.handleSupabaseError(error, 'Failed to update user profile');
```

Route Supabase errors through `handleSupabaseError` rather than throwing ad hoc.

⚠️ **The backend holds the service-role key, which bypasses RLS entirely.** Nothing in the database will stop a query from reading or writing another user's rows. Every query must scope itself — `.eq('id', user.id)` or equivalent — and the correctness of that is entirely on the code you write here.

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

`UsersService.createUserProfile` touches `coaches`, `athletes`, and `users`. There is **no transaction available** through the Supabase client, so the method is structured defensively and the order matters:

1. All cross-field validation (division↔federation, weight-class↔federation↔gender) runs **before any write**.
2. Inserts are tracked in `insertedTables` as they succeed.
3. If a later step fails, `rollbackInsertedProfiles` deletes them in reverse order.

Rollback is **best-effort**: failures there are logged, never thrown, so the original error still reaches the caller. Keep that property — throwing from rollback replaces the real cause with a misleading one. If you add a fourth write to this flow, add it to the tracked set too.

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

⚠️ **E2E is not hermetic. It mutates a shared live project.** Both suites create real auth users via `supabase.auth.signUp()` and clean up afterward; a mid-test failure leaks orphaned records. Treat a local e2e run as a write to production data, and prefer letting CI run it.

Two things to follow when adding a spec:

- **Look reference data up at runtime.** `athlete-retrieve.e2e-spec.ts` queries for a division and a matching weight class in `beforeAll`, so it's portable across Supabase projects. `users.e2e-spec.ts` still hardcodes remote UUIDs — the older, more brittle pattern.
- **Mirror `main.ts` exactly** — the same `ValidationPipe` options *and* `app.useGlobalFilters(new GlobalExceptionFilter())`. Both existing specs do. Drift here means asserting against an error shape production doesn't return.

## Conventions

- **Imports are absolute from `src/...`** — no `@/` alias here (that's the frontend). This works via `baseUrl: "./"` with no `paths`, mirrored by `moduleNameMapper` in both Jest configs. Same-feature imports stay relative (`../service/users.service`).
- `RequestWithUser` must be imported with **`import type`** so Nest's decorator metadata doesn't choke on it.
- Single quotes, trailing commas, `printWidth: 100`, 2-space tabs (`.prettierrc`).
- ESLint is `recommendedTypeChecked`, but loosened: `no-explicit-any` **off**, `no-console` **off**, and `no-unsafe-*` / `no-unused-vars` downgraded to `warn` (`_`-prefixed args and vars are ignored). `prettier/prettier` is an **error**, so formatting breaks the build.
- TS is **not strict**: `strictNullChecks: true` but `noImplicitAny: false`, and no `"strict": true`. Don't assume frontend-level safety.
- JSDoc `/** ... */` with `@param`/`@returns` on non-obvious methods.

## Environment

`backend/.env` (gitignored, no template committed):

- `SUPABASE_PROJECT_URL`
- `SUPABASE_SECRET_KEY` — the **service-role** key. Bypasses RLS. Never log it, never move it into anything `EXPO_PUBLIC_*`.
- `PORT` (default 8000), `HOST` (default `0.0.0.0`), `NODE_ENV`

Loaded via `ConfigModule.forRoot({ isGlobal: true })`. `SupabaseService` throws `NotFoundException` at construction if either Supabase var is absent, so **the app won't boot without them** — a fast, obvious failure, unlike the frontend.

## Gotchas

- **`npm run lint` is `eslint --fix` and rewrites your files.** Use `npx eslint "{src,apps,libs,test}/**/*.ts"` to check without mutating. Because CI runs the `--fix` form and discards the result, pure formatting violations *pass* CI and then reappear as local diff noise.
- **Name e2e files `*.e2e-spec.ts`.** `testRegex` is now `\.e2e[-.]spec\.ts$` so both hyphen and dot forms are picked up, but the hyphen form is the convention. (Two specs were silently never running before the regex was widened.)
- **`coach.controller.ts` / `coach.service.ts` are unimplemented Nest CLI scaffolding.** The service returns string literals like `` `This action returns all users` `` and the routes have no guards. Not a pattern to imitate, and not working features.
- `VALID_TABLE_FIELDS.users` also allowlists `email` and `role`, neither of which the app ever writes. `role` in particular looks vestigial — superseded by `is_athlete` / `is_coach`. Both are opt-in via `?data=`; the default `PUBLIC_PROFILE_QUERY` deliberately omits them so it can't fail on a missing column. Verify against the live schema before relying on either.
- File naming is genuinely inconsistent — `entities/` is PascalCase (`UserData.ts`) while everything else is kebab-case, and specs mix `users.controller.spec.ts` with `athlete-controller.spec.ts`. **Match the nearest sibling file** rather than inventing a house style or mass-renaming.
- `PATCH /athlete/profile` does **not** exist, though `UpdateAthleteDto` (name-based `federation` / `division` / `weight_class`) is written and unused — it's the shape a future endpoint was meant to take. See `docs/ARCHITECTURE.md`.
- `README.md` in this directory is unmodified NestJS boilerplate — ignore it.
