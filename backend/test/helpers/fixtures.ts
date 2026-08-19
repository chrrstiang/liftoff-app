/** Shared e2e fixture helpers.
 *
 * ⚠️ **Every e2e run in this project writes to the live Supabase project** — the
 * same database real users are in. There is no staging project and no local
 * database. That is a deliberate, recorded tradeoff, and these helpers exist to
 * make it survivable:
 *
 *  - Every artifact is prefixed so a sweeper can find it (`sweepE2EArtifacts`).
 *  - Teardown runs from globalTeardown, not just afterEach, so a crashed run
 *    still gets cleaned up.
 *  - `requireLiveOptIn()` refuses to run without E2E_ALLOW_LIVE=1, so a tired
 *    `npm run test:e2e` cannot quietly mutate production.
 *
 * ⚠️ **Never call `signUp` or `signInWithPassword` on the service-role client.**
 * supabase-js resolves the PostgREST Authorization header as
 * `session?.access_token ?? supabaseKey`, so the moment a session exists on a
 * client, every query it makes runs as that *user* instead of as service_role.
 * `users.e2e-spec.ts` did this, which meant four of its tests were asserting
 * against `authenticated` behaviour while claiming to test the service-role path
 * — and its RLS-blocked cleanup DELETEs returned zero rows with no error, so the
 * try/catch never fired and rows leaked. Use `createTestUser`, which creates via
 * the admin API and mints tokens on a throwaway client.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

/** Data now lives in Postgres, not Supabase. These fixtures are therefore hybrid:
 * **auth** operations go to Supabase (that is where auth genuinely lives) and
 * **data** operations go to the database the API writes to.
 *
 * That split is why the suite is now hermetic for data — a local Postgres in CI
 * means table rows never touch a shared project again. Only auth users do. */
let dataPool: Pool | undefined;

export function dataDb(): Pool {
  if (!dataPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. e2e writes to Postgres now, not Supabase. ' +
          'Locally: `npm run db:up && npm run db:migrate && npm run db:seed`.',
      );
    }
    dataPool = new Pool({ connectionString, max: 4 });
  }
  return dataPool;
}

export async function closeDataDb(): Promise<void> {
  await dataPool?.end();
  dataPool = undefined;
}

/** Stable across schema changes: the sweeper matches on these, not on the run id,
 * so cleanup still works for artifacts left by an older revision of this file. */
export const E2E_EMAIL_PREFIX = 'e2e-';
export const E2E_USERNAME_PREFIX = 'e2e_';

/** Non-deliverable by RFC 2606. The old fixture minted @gmail.com addresses, which
 * would generate real bounces against the project's SMTP reputation the moment
 * email confirmation is switched on. */
const E2E_EMAIL_DOMAIN = 'example.com';

export const TEST_PASSWORD = 'TestPassword123!';

/** Short and base36 on purpose: CreateUserDto caps username at 30 chars and only
 * allows [a-z0-9._], so `Date.now()` + `Math.random()` does not fit. */
function generateRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** One id per `npm run test:e2e` invocation, set by globalSetup.
 *
 * The fallback matters: if globalSetup did not run (someone invoking jest
 * directly), a per-process id still groups that process's artifacts, and the
 * sweeper keys off the stable prefixes above regardless. So correctness never
 * depends on env propagation into workers. */
export function runId(): string {
  if (!process.env.E2E_RUN_ID) {
    process.env.E2E_RUN_ID = generateRunId();
  }
  return process.env.E2E_RUN_ID;
}

/** Guard against accidentally mutating production data.
 *
 * CI sets E2E_ALLOW_LIVE=1. Locally you have to type it, which is the entire
 * point — it converts "I forgot these tests hit prod" into a failed run. */
export function requireLiveOptIn(): void {
  if (process.env.E2E_ALLOW_LIVE !== '1') {
    throw new Error(
      'Refusing to run e2e tests: these write to the LIVE Supabase project that ' +
        'real users are in. There is no staging project.\n\n' +
        'If you understand that and still want to run them:\n' +
        '  E2E_ALLOW_LIVE=1 npm run test:e2e\n\n' +
        'Afterwards, confirm nothing leaked:\n' +
        '  E2E_ALLOW_LIVE=1 npm run e2e:sweep',
    );
  }
}

export interface TestUser {
  userId: string;
  email: string;
  username: string;
  /** A real access token for this user, minted on a throwaway client. */
  token: string;
}

export interface ReferenceData {
  federationId: string;
  divisionId: string;
  weightClassId: string;
  /** The weight class's gender. The app cross-validates weight class against the
   * user's gender, so a fixture must use this rather than picking one. */
  gender: string;
}

/** A second client purely for minting tokens, so the service-role client never
 * acquires a session. `persistSession: false` keeps concurrent sign-ins from
 * clobbering each other through shared storage. */
export function createAuthClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Looks reference data up at runtime instead of hardcoding UUIDs.
 *
 * `users.e2e-spec.ts` hardcoded federation/division/weight-class ids, which
 * pinned CI to specific production rows: reference data could never be reseeded
 * without breaking the suite, and the suite could never be fixed by deleting rows
 * real users point at. */
export async function findReferenceData(_supabase?: SupabaseClient): Promise<ReferenceData> {
  const db = dataDb();

  const { rows: divisionRows } = await db.query<{ id: string; federation_id: string }>(
    'select id, federation_id from divisions limit 1',
  );
  const division = divisionRows[0];

  if (!division) {
    throw new Error(
      'No divisions in the test database — run `npm run db:seed` (CI does this in the ' +
        '"Migrate and seed the test database" step).',
    );
  }

  const { rows: weightClassRows } = await db.query<{ id: string; gender: string }>(
    'select id, gender from weight_classes where federation_id = $1 limit 1',
    [division.federation_id],
  );
  const weightClass = weightClassRows[0];

  if (!weightClass) {
    throw new Error(`No weight_classes for federation ${division.federation_id} — reseed.`);
  }

  return {
    federationId: division.federation_id,
    divisionId: division.id,
    weightClassId: weightClass.id,
    gender: weightClass.gender,
  };
}

/** Transient auth failures worth waiting out. A genuinely bad request (duplicate
 * email, malformed address) is not retried -- that would just slow down a real
 * failure. */
function isTransientAuthError(message: string): boolean {
  return /database error|rate limit|too many|timeout|temporarily/i.test(message);
}

async function createAuthUserWithRetry(supabase: SupabaseClient, email: string) {
  const delays = [1_000, 3_000, 8_000, 15_000];
  let lastMessage = 'no user returned';

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });

    if (!error && data.user) return data;

    lastMessage = error?.message ?? 'no user returned';

    if (!error || !isTransientAuthError(lastMessage) || attempt === delays.length) break;

    console.warn(
      `[e2e] auth createUser attempt ${attempt + 1} failed (${lastMessage}); ` +
        `retrying in ${delays[attempt] / 1000}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }

  throw new Error(
    `Failed to create test user: ${lastMessage}. ` +
      'If this says "Database error creating new user", it is almost certainly the ' +
      "Supabase project's per-hour auth rate limit rather than a broken trigger -- " +
      'verify by creating a user by hand before chasing the schema.',
  );
}

let userCounter = 0;

/** Creates a confirmed auth user and returns a usable access token.
 *
 * `onCreated` is invoked the instant the auth user exists — before anything that
 * can throw — so a fixture that fails partway can still be torn down. The old
 * spec only recorded the id on full success, so a mid-fixture failure orphaned an
 * auth user on every run.
 */
export async function createTestUser(
  supabase: SupabaseClient,
  authClient: SupabaseClient,
  onCreated?: (userId: string) => void,
): Promise<TestUser> {
  const n = ++userCounter;
  const id = runId();
  const email = `${E2E_EMAIL_PREFIX}${id}-${n}@${E2E_EMAIL_DOMAIN}`;
  const username = `${E2E_USERNAME_PREFIX}${id}_${n}`;

  // admin.createUser, not signUp: it is an admin endpoint, so it leaves no session
  // on the client, and email_confirm removes any dependency on the project having
  // email confirmation switched off.
  //
  // Retried with backoff because auth is the one dependency still on the shared
  // Supabase project, and its rate limit is per-hour and cumulative across CI
  // runs. When tripped it returns "Database error creating new user", which reads
  // like a broken trigger rather than throttling and has already cost one
  // debugging detour. Retrying is the honest response to a shared, throttled
  // dependency; the alternative is a suite that fails for reasons unrelated to
  // the code under test.
  const created = await createAuthUserWithRetry(supabase, email);

  const userId = created.user.id;
  onCreated?.(userId);

  const { data: auth, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });

  if (signInError || !auth.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message ?? 'no session'}`);
  }

  return { userId, email, username, token: auth.session.access_token };
}

/** Marks a users row as an e2e artifact even if the username scheme later drifts.
 * `last_name` carries the run id so a leaked row can be traced to a specific run. */
export function e2eProfileMarkers(): { first_name: string; last_name: string } {
  return { first_name: 'E2E', last_name: runId() };
}

/** Child tables to clear before deleting the users/athletes/coaches rows.
 *
 * Ordered to respect foreign keys, parents last. Adding a table as new slices land
 * is a one-line change here; the alternative is a leak that only shows up as a
 * confusing FK violation weeks later.
 *
 * `column` names the FK that points at a test user. Tables reachable only through
 * another table (sets -> workout_exercises) are handled in sweepForUserIds.
 */
const DIRECT_USER_REFERENCES: ReadonlyArray<{ table: string; columns: string[] }> = [
  { table: 'messages', columns: ['user_id'] },
  { table: 'conversation_members', columns: ['user_id'] },
  { table: 'coach_requests', columns: ['athlete_id', 'coach_id'] },
  { table: 'coach_athlete_relationships', columns: ['athlete_id', 'coach_id'] },
  { table: 'exercise_templates', columns: ['created_by'] },
  { table: 'exercises', columns: ['created_by'] },
];

/** Deletes everything belonging to the given user ids, children first.
 *
 * Rows come out of Postgres; the auth users come out of Supabase. Adding a table
 * to a spec means adding it here, or its rows leak — though "leak" now means a
 * throwaway CI database rather than production, which is the whole point of the
 * move.
 */
async function sweepForUserIds(supabase: SupabaseClient, userIds: string[]): Promise<string[]> {
  const problems: string[] = [];
  if (userIds.length === 0) return problems;

  const db = dataDb();

  // Deepest first. A single statement per table, using = ANY($1) so the id list
  // is a bound parameter rather than interpolated.
  const statements: Array<[string, string]> = [
    [
      'sets',
      `delete from sets where workout_exercise_id in (
       select we.id from workout_exercises we join workouts w on w.id = we.workout_id
       where w.athlete_id = any($1) or w.coach_id = any($1))`,
    ],
    [
      'workout_exercises',
      `delete from workout_exercises where workout_id in (
       select id from workouts where athlete_id = any($1) or coach_id = any($1))`,
    ],
    ['workouts', 'delete from workouts where athlete_id = any($1) or coach_id = any($1)'],
    ['messages', 'delete from messages where user_id = any($1)'],
    ['conversation_members', 'delete from conversation_members where user_id = any($1)'],
    [
      'coach_requests',
      'delete from coach_requests where athlete_id = any($1) or coach_id = any($1)',
    ],
    [
      'coach_athlete_relationships',
      'delete from coach_athlete_relationships where athlete_id = any($1) or coach_id = any($1)',
    ],
    ['exercise_templates', 'delete from exercise_templates where created_by = any($1)'],
    ['exercises', 'delete from exercises where created_by = any($1)'],
    ['athletes', 'delete from athletes where id = any($1)'],
    ['coaches', 'delete from coaches where id = any($1)'],
    ['users', 'delete from users where id = any($1)'],
  ];

  for (const [table, text] of statements) {
    try {
      await db.query(text, [userIds]);
    } catch (error) {
      problems.push(`${table}: ${(error as Error).message}`);
    }
  }

  for (const userId of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    // "not found" is expected when a previous teardown already got it.
    if (error && !/not found/i.test(error.message)) {
      problems.push(`auth user ${userId}: ${error.message}`);
    }
  }

  return problems;
}

/** Tears down the users created by the current spec file. Safe to call from
 * afterAll; the globalTeardown sweeper is the backstop for crashed runs. */
export async function cleanupUsers(supabase: SupabaseClient, userIds: string[]): Promise<void> {
  const problems = await sweepForUserIds(supabase, userIds.filter(Boolean));
  if (problems.length > 0) {
    console.error(`[e2e cleanup] partial failure:\n  ${problems.join('\n  ')}`);
  }
}

export interface SweepOptions {
  /** Skip users newer than this, so a sweep never deletes a concurrently running
   * suite's fixtures out from under it. Set to 0 to sweep everything. */
  minAgeMinutes?: number;
}

/** Finds and removes every leaked e2e artifact in the project.
 *
 * Matches on the email prefix rather than the run id, so it also collects debris
 * from runs that crashed before recording anything — which is the case
 * `afterEach` structurally cannot handle.
 */
export async function sweepE2EArtifacts(
  supabase: SupabaseClient,
  options: SweepOptions = {},
): Promise<{ swept: number; problems: string[] }> {
  const minAgeMinutes = options.minAgeMinutes ?? 0;
  const cutoff = Date.now() - minAgeMinutes * 60_000;

  const staleIds: string[] = [];
  let page = 1;

  // listUsers paginates; a project with real users in it will have many pages.
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      return { swept: 0, problems: [`listUsers: ${error.message}`] };
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      if (!user.email?.startsWith(E2E_EMAIL_PREFIX)) continue;
      if (!user.email.endsWith(`@${E2E_EMAIL_DOMAIN}`)) continue;
      if (new Date(user.created_at).getTime() > cutoff) continue;
      staleIds.push(user.id);
    }

    if (users.length < 200) break;
    page += 1;
  }

  const problems = await sweepForUserIds(supabase, staleIds);
  return { swept: staleIds.length, problems };
}

/** Builds a service-role client from env, for standalone scripts that run outside
 * the Nest test harness (npm run e2e:sweep). */
export function createServiceClientFromEnv() {
  const url = process.env.SUPABASE_PROJECT_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_PROJECT_URL and SUPABASE_SECRET_KEY must be set (see backend/.env.example).',
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
