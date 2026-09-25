import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from 'src/db/schema';

/** A real Postgres, for the things a mock structurally cannot show.
 *
 * ⚠️ **Why this tier exists.** `db-mock` ignores `where` entirely, fakes
 * transactions by running the callback against the same client, and passes raw
 * `sql` fragments through inert. So nothing whose correctness *is* the SQL —
 * a counter allocated under a row lock, an `ON CONFLICT` arbiter matching its
 * index, a cursor that must not repeat across a page boundary — can be expressed
 * against it. A spec that tries will pass with the logic deleted.
 *
 * The obvious home for those would be the e2e suite, and it is the wrong one:
 * `backend-e2e` skips itself when the Supabase secrets are absent or the project
 * is paused, so a green check there is not evidence anything ran. These run in
 * `backend-ci`, which always runs, and they touch no Supabase at all.
 *
 * Locally: `npm run db:up && npm run db:migrate && npm run db:seed`, which gives
 * Postgres on 55440. CI stands one up on 5432. Both are read from `DATABASE_URL`
 * rather than hardcoded, because they differ.
 */
const DEFAULT_URL = 'postgres://postgres@127.0.0.1:55440/liftoff';

export interface IntDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** For the cases that need two real connections — a lock held on one while the
   * other blocks. A pooled client cannot demonstrate that against itself. */
  connect: () => Promise<PoolClient>;
  close: () => Promise<void>;
}

export function makeIntDb(): IntDb {
  const connectionString = process.env.DATABASE_URL || DEFAULT_URL;

  /* Room for the concurrency cases to hold two or three connections at once and
     still have one spare for the assertion query. The app's own pool is 10. */
  const pool = new Pool({ connectionString, max: 6 });

  return {
    db: drizzle(pool, { schema }),
    connect: () => pool.connect(),
    close: () => pool.end(),
  };
}

/** Waits until `predicate` holds, polling.
 *
 * ⚠️ **Never `sleep` in these specs.** A fixed wait is either flaky on a loaded
 * CI box or slow on every run, and for the lock cases it is asserting nothing —
 * "it had not finished after 50ms" is not "it blocked". Poll for the state you
 * actually mean, with a bound.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 5_000, intervalMs = 25 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
