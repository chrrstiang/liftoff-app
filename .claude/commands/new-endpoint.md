---
description: Scaffold a NestJS endpoint following the users-module pattern
argument-hint: [METHOD /route — what it should do]
---

Add a new backend endpoint: **$ARGUMENTS**

Follow the existing `users` module rather than Nest CLI defaults. Read `backend/CLAUDE.md` first, then these as your reference implementation:

- `backend/src/users/controller/users.controller.ts` — controller shape
- `backend/src/users/service/users.service.ts` — service + Supabase error handling
- `backend/src/users/dto/create-user.dto.ts` — DTO validation
- `backend/src/users/users.module.ts` — wiring

## Steps

1. **Clarify first if the request is ambiguous** — HTTP method, path, auth requirement, request/response shape. Don't guess at a data model.

2. **DTO** in the feature's `dto/` directory. Every accepted field needs a `class-validator` decorator, because the global `ValidationPipe` runs `forbidNonWhitelisted` — an undeclared field is a 400. Use `@IsOptional()` for optional fields. For uniqueness or existence checks against the DB, reuse the existing DI-backed validators `@IsUnique(table, column)` and `@ValueExists(table, column)` rather than writing manual lookups.

3. **Service method.** Get the client via `this.supabaseService.getClient()`. Funnel Supabase errors through `handleSupabaseError(error, 'Failed to ...')`. **Scope every query to the authenticated user** (`.eq('id', user.id)` or equivalent) — the backend uses the service-role key and bypasses RLS, so nothing else will stop cross-user access.

4. **Controller method.** `@UseGuards(JwtAuthGuard)` on the route (not the class), explicit `@HttpCode(...)`, `@Body() dto: YourDto`, `@Req() req: RequestWithUser` imported with **`import type`**. Keep it thin — delegate immediately and return `{ message: '...' }`. Add a JSDoc block with `@param`/`@returns`.

5. **Register** the controller and service in the module's `providers`/`controllers`.

6. **Unit spec** colocated as `*.spec.ts`, mocking `SupabaseService` via `@nestjs/testing` provider overrides — match the style of `users.service.spec.ts`.

7. **Verify**: `cd backend && npx eslint "{src,apps,libs,test}/**/*.ts" && npx tsc --noEmit && npm test`

## Constraints

- Absolute `src/...` imports for `common/` and `supabase/`; relative for same-feature.
- Single quotes, `printWidth: 100`. Prettier violations are ESLint **errors**.
- Match the naming of the nearest sibling files — this codebase is inconsistent (kebab-case files, PascalCase entities, mixed spec naming). Don't mass-rename.
- **Do not copy `coach.controller.ts` / `coach.service.ts`** — they're unimplemented scaffolding returning string literals, with no guards.
- If the endpoint reads a table via a caller-supplied field list, extend the allowlists in `common/types/select.queries.ts` deliberately — and never add `user_id`.
- If you need an e2e spec, name it `*.e2e-spec.ts` (hyphen — the dot form is not matched by `testRegex` and silently never runs) and include `useContainer(app.select(AppModule), { fallbackOnErrors: true })` in the bootstrap or the async validators will fail.
