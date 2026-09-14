import {
  PUBLIC_PROFILE_QUERY,
  VALID_ATHLETES_COLUMNS_QUERIES,
  VALID_FULL_TABLE_QUERIES,
  VALID_TABLE_FIELDS,
} from './select.queries';

/** These allowlists are the only thing constraining what `GET /athlete/profile/:id`
 * returns, and there is no RLS behind them.
 *
 * `athlete-retrieve.e2e-spec.ts` already asserts that specific off-allowlist queries
 * are rejected — but every query it names is one that is *already* absent, so those
 * tests cannot notice a field being **added**. Re-adding `email` to
 * `VALID_TABLE_FIELDS.users` would have passed that entire suite while exposing
 * another user's PII on a profile endpoint any authenticated caller can reach.
 *
 * So this spec pins the allowlists by their **contents**. It is meant to fail when
 * someone widens one: that failure is the review prompt, and the fix is to change
 * this file deliberately, not to make the assertion pass.
 */
describe('profile select allowlists', () => {
  it('exposes exactly five athlete columns, and never user_id', () => {
    expect([...VALID_ATHLETES_COLUMNS_QUERIES].sort()).toEqual([
      'division_id',
      'federation_id',
      'id',
      'team_id',
      'weight_class_id',
    ]);

    // user_id maps to the auth uid. It has never been reachable and must not become so.
    expect(VALID_ATHLETES_COLUMNS_QUERIES.has('user_id')).toBe(false);
  });

  it('exposes exactly four user fields, and no PII beyond a display name', () => {
    expect([...VALID_TABLE_FIELDS.users].sort()).toEqual([
      'first_name',
      'gender',
      'last_name',
      'username',
    ]);

    // email is NOT NULL on users, so allowlisting it would always succeed and always
    // leak. role is not a column at all — it was allowlisted once and every
    // ?data=users.role was a guaranteed 500.
    expect(VALID_TABLE_FIELDS.users).not.toContain('email');
    expect(VALID_TABLE_FIELDS.users).not.toContain('role');
  });

  it('opens only reference tables to full-table selection', () => {
    expect([...VALID_FULL_TABLE_QUERIES].sort()).toEqual([
      'divisions',
      'federations',
      'weight_classes',
    ]);

    // Reference data is shared and public; user-owned tables are not, and a
    // `users (*)` would bypass the per-field list above entirely.
    expect(VALID_FULL_TABLE_QUERIES.has('users')).toBe(false);
    expect(VALID_FULL_TABLE_QUERIES.has('athletes')).toBe(false);
  });

  it('allowlists only tables it also has a field list for', () => {
    // A table in VALID_TABLE_FIELDS with no entries, or a full-table entry with no
    // corresponding field list, is the shape a half-finished widening takes.
    for (const table of VALID_FULL_TABLE_QUERIES) {
      expect(Object.keys(VALID_TABLE_FIELDS)).toContain(table);
    }

    for (const [table, fields] of Object.entries(VALID_TABLE_FIELDS)) {
      expect(fields.length).toBeGreaterThan(0);
      expect(table).not.toMatch(/^athletes$/);
    }
  });

  it('keeps the default profile query inside the allowlists', () => {
    // The default runs when no ?data= is given, so it bypasses the compiler's checks
    // entirely. Nothing else would catch it drifting to a field the allowlist forbids.
    expect(PUBLIC_PROFILE_QUERY).toContain('first_name, last_name, username, gender');
    expect(PUBLIC_PROFILE_QUERY).not.toContain('email');
    expect(PUBLIC_PROFILE_QUERY).not.toContain('user_id');
    expect(PUBLIC_PROFILE_QUERY).not.toContain('role');
  });
});
