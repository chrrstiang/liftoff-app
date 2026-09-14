---
description: Scaffold a NestJS endpoint following the users-module pattern
argument-hint: [METHOD /route — what it should do]
---

Add a new backend endpoint: **$ARGUMENTS**

Follow the existing modules rather than Nest CLI defaults. Read `backend/CLAUDE.md` first, then these as your reference implementation:

- `backend/src/users/controller/users.controller.ts` — controller shape
- `backend/src/users/service/users.service.ts` — service, Drizzle access, transactional multi-table write
- `backend/src/programming/service/programming-access.ts` — **the worked example for ownership checks**
- `backend/src/users/dto/create-user.dto.ts` — DTO validation
- `backend/src/users/users.module.ts` — wiring

## Steps

1. **Clarify first if the request is ambiguous** — HTTP method, path, auth requirement, request/response shape. Don't guess at a data model.

2. **DTO** in the feature's `dto/` directory. Every accepted field needs a `class-validator` decorator, because the global `ValidationPipe` runs `forbidNonWhitelisted` — an undeclared field is a 400. Use `@IsOptional()` for optional fields. For uniqueness or existence checks against the DB, reuse the DI-backed validators `@IsUnique(table, column)` and `@ValueExists(table, column)` rather than writing manual lookups.

   ⚠️ If the DTO extends `PartialType(...)`, that only relaxes **inherited** fields. A field declared on the subclass keeps its `@IsNotEmpty()` and will be required on every request. This exact mistake made `PATCH /users/profile` reject every call for weeks — see `docs/AUTHORIZATION.md` Finding 4.

3. **Service method.** Inject Drizzle: `constructor(@Inject(DRIZZLE) private readonly db: Database) {}`. `DbModule` is `@Global`, so no module import is needed. Build queries with Drizzle operators (`eq`, `and`, `inArray`) against `src/db/schema.ts`.

   **Scope every query to the authenticated user** — `eq(users.id, user.id)`, or a walk up the ownership chain. ⚠️ **There is no RLS.** Nothing in the database will stop a query reading or writing another user's rows; the correctness of that scoping is entirely this code. Getting one wrong is a data breach, not a bug.

   Two rules that fall out of that:
   - **Never take an actor id from the request body.** The caller comes from the verified token. A client-supplied `coach_id` or `sender_id` must be a 400.
   - **Prefer 404 over 403** when the caller has no claim on a resource. A 403 confirms the id names something real, which with enumerable ids leaks who is training or talking to whom. Use 403 only when the caller can already see the resource but may not perform this action (see `loadProgrammableWorkout`).

4. **Controller method.** `@UseGuards(JwtAuthGuard)` on the route (**not** the class), explicit `@HttpCode(...)`, `@Body() dto: YourDto`, `@Req() req: RequestWithUser` imported with **`import type`**. Use `ParseUUIDPipe` on uuid params so a malformed id is a 400 rather than a 500. Keep it thin — delegate immediately and return `{ message: '...' }`. Add a JSDoc block with `@param`/`@returns`.

5. **Register** the controller and service in the module's `providers`/`controllers`.

6. **Unit spec** colocated as `*.spec.ts`, using the shared Drizzle double at `backend/src/db/testing/db-mock.ts`. It routes results **by table, not by call order** — a flat queue makes every spec depend on the exact query sequence, so adding one validation read silently shifts every later result onto the wrong statement. Match the style of `workouts.service.spec.ts`.

   ⚠️ A mocked db **cannot distinguish valid SQL from invalid**. Rules belong in the unit spec; that the query actually runs belongs in e2e.

7. **e2e spec** if the endpoint has an ownership rule — which is most of them. A rule with no e2e assertion is not enforced as far as anyone can tell. Name it `*.e2e-spec.ts`, use `test/helpers/fixtures.ts` for users and teardown, and add at minimum: the owner succeeds, an outsider gets 404, and an unauthenticated request gets 401. Add the resource's tables to the `statements` array in `sweepForUserIds` or its rows leak.

8. **Verify**: `cd backend && npx eslint "{src,apps,libs,test}/**/*.ts" && npx tsc --noEmit && npm test`

## Constraints

- Absolute `src/...` imports for `common/`, `db/` and `supabase/`; relative for same-feature.
- Single quotes, `printWidth: 100`. Prettier violations are ESLint **errors**.
- Match the naming of the nearest sibling files — this codebase is inconsistent (kebab-case files, PascalCase entities, mixed spec naming). Don't mass-rename.
- **Never scaffold a controller you aren't ready to guard.** `CoachController` was mounted with no `@UseGuards` on any of its six routes and served unauthenticated in production for months; it was deleted rather than fixed. An unimplemented controller that is *registered* is not harmless.
- If the endpoint reads a table via a caller-supplied field list, extend the allowlists in `common/types/select.queries.ts` deliberately — and never add `user_id` or `email`. `select.queries.spec.ts` pins those allowlists **by contents** and is meant to fail when you widen one; that failure is the review prompt, not something to make pass.
- Errors are shaped by the globally registered `GlobalExceptionFilter`: `{ statusCode, message, timestamp, path, method }`. Just throw the appropriate Nest exception; don't format responses yourself.
- If the endpoint writes to more than one table, use a real transaction: `db.transaction(async (tx) => ...)`. Validate everything **before** opening it — those are reads, and a clean 400 beats an aborted transaction. Do not reintroduce the old compensating-delete pattern; it existed only because supabase-js had no transaction API.
- e2e bootstrap must mirror `main.ts` exactly — the `ValidationPipe` options, `app.useGlobalFilters(new GlobalExceptionFilter())`, and `useContainer(app.select(AppModule), { fallbackOnErrors: true })`, without which the async validators silently pass.
