import { sql } from 'drizzle-orm';
import { makeIntDb, waitFor, type IntDb } from './int-db';

/** Proves the integration tier is actually wired up.
 *
 * ⚠️ **This is not a formality.** The failure mode being guarded against is a
 * misconfigured job that reports success having run nothing — which is exactly
 * what `backend-e2e` does when the Supabase secrets are missing, and the reason
 * this tier exists. If the service container or `DATABASE_URL` is wrong, this
 * goes red rather than the suite quietly passing with zero specs.
 */
describe('integration database', () => {
  let harness: IntDb;

  beforeAll(() => {
    harness = makeIntDb();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('connects to a real Postgres', async () => {
    const result = await harness.db.execute(sql`select 1 as ok`);

    expect(result.rows[0]).toEqual({ ok: 1 });
  });

  /** The migrations have to have been applied, or every spec in this tier is
   * asserting against an empty schema. */
  it('has the migrated schema, not an empty database', async () => {
    const result = await harness.db.execute(
      sql`select count(*)::int as tables from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );

    expect(Number((result.rows[0] as { tables: number }).tables)).toBeGreaterThanOrEqual(19);
  });

  /** Two real connections, which is the capability the counter-ordering specs
   * need and the one a mocked client cannot provide at all. */
  it('hands out independent connections that can hold a transaction open', async () => {
    const a = await harness.connect();
    const b = await harness.connect();

    try {
      await a.query('begin');
      await a.query('create temporary table int_probe (v int)');

      // `b` cannot see `a`'s uncommitted temporary table — they are genuinely
      // separate sessions, not the same one handed back twice.
      await expect(b.query('select * from int_probe')).rejects.toThrow();

      await a.query('rollback');
    } finally {
      a.release();
      b.release();
    }
  });

  /** `waitFor` is what replaces `sleep` in the lock cases, so it is worth
   * knowing it both resolves and gives up. */
  it('waitFor resolves once the condition holds', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 40);

    await expect(waitFor(() => Promise.resolve(ready))).resolves.toBeUndefined();
  });

  it('waitFor gives up rather than hanging the suite', async () => {
    await expect(waitFor(() => Promise.resolve(false), { timeoutMs: 60 })).rejects.toThrow(
      /Condition not met/,
    );
  });
});
