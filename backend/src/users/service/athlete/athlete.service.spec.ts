import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { AthleteService } from './athlete.service';
import { DRIZZLE } from 'src/db/db.module';
import { athletes } from 'src/db/schema';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';

/** Tests for the `?data=` sparse-fieldset compiler.
 *
 * The previous version asserted on the PostgREST select *string* the service
 * built (`'id, users (username)'`). That string no longer exists — the service
 * builds a Drizzle selection instead — so these assert on the columns actually
 * selected, which is the same intent expressed against the new mechanism.
 *
 * Selection keys are `table.column`, so `'users.username'` here means the same
 * thing `'users (username)'` used to.
 */
describe('AthleteService - retrieveProfileDetails', () => {
  let service: AthleteService;
  /** Columns handed to db.select() on the last call. */
  let selected: string[];

  beforeEach(async () => {
    selected = [];

    const chain = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    const db = {
      select: jest.fn().mockImplementation((sel: Record<string, unknown>) => {
        selected = Object.keys(sel);
        return chain;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AthleteService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get<AthleteService>(AthleteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('selects the default profile when no data param is given', async () => {
    await service.retrieveProfileDetails('athlete-1');

    expect(selected).toContain('athletes.id');
    expect(selected).toContain('users.username');
    expect(selected).toContain('users.first_name');
    // Full-table requests expand to every allowlisted column.
    expect(selected).toContain('federations.code');
    expect(selected).toContain('divisions.name');
    expect(selected).toContain('weight_classes.name');
    // Never exposed: email is another user's PII, and there is no `role` column.
    expect(selected).not.toContain('users.email');
    expect(selected).not.toContain('users.role');
  });

  it('selects exactly the requested direct and nested fields', async () => {
    await service.retrieveProfileDetails('athlete-1', ['id', 'users.username']);

    expect(selected.sort()).toEqual(['athletes.id', 'users.username']);
  });

  it('deduplicates repeated fields', async () => {
    await service.retrieveProfileDetails('athlete-1', ['id', 'id', 'users.username']);

    expect(selected.sort()).toEqual(['athletes.id', 'users.username']);
  });

  /** A full-table request subsumes any nested field from the same table, so
   * asking for both should not select the column twice or narrow the table. */
  it('drops nested fields made redundant by a full-table request', async () => {
    await service.retrieveProfileDetails('athlete-1', ['federations', 'federations.id']);

    expect(selected).toContain('federations.id');
    expect(selected).toContain('federations.name');
    expect(selected).toContain('federations.code');
    expect(selected.filter((k) => k === 'federations.id')).toHaveLength(1);
  });

  it('expands a full-table request to every allowlisted column of that table', async () => {
    await service.retrieveProfileDetails('athlete-1', ['weight_classes']);

    expect(selected).toEqual(
      expect.arrayContaining(['weight_classes.min_weight', 'weight_classes.sort_order']),
    );
  });

  describe('rejects anything off-allowlist', () => {
    // These allowlists are the only thing constraining what this endpoint
    // returns, so each rejection is a security assertion, not a validation nicety.
    const cases: Array<[string, string[]]> = [
      ['an invalid direct column', ['name']],
      ['an invalid nested column', ['federations.horse']],
      ['a table that is not full-table queryable', ['users']],
      ['user_id, which maps to the auth identity', ['user_id']],
      ['a mistyped table prefix', ['user.username']],
      ['a nested column with no prefix', ['username']],
    ];

    it.each(cases)('%s', async (_name, data) => {
      await expect(service.retrieveProfileDetails('athlete-1', data)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('returns null when the athlete has no row', async () => {
    await expect(service.retrieveProfileDetails('missing')).resolves.toBeNull();
  });
});

/** Tests for `PATCH /athlete/profile`.
 *
 * The assertions that matter here are the two scoping ones. With no RLS behind
 * this service, `eq(athletes.id, user.id)` on the read and on the write is the
 * whole authorization — so both `where` clauses are compared against a freshly
 * built `eq(athletes.id, CALLER)`, not just counted. An unscoped
 * `update athletes set ...` would pass a call-count assertion and rewrite every
 * athlete row in the database.
 */
describe('AthleteService - updateOwnProfile', () => {
  const CALLER = '11111111-1111-1111-1111-111111111111';
  const OTHER = '22222222-2222-2222-2222-222222222222';
  const FED = '33333333-3333-3333-3333-333333333333';
  const DIV = '44444444-4444-4444-4444-444444444444';
  const WC = '55555555-5555-5555-5555-555555555555';

  const caller = { id: CALLER, email: 'caller@example.invalid' } as User;

  /** One athlete row as the merge step reads it. */
  const currentRow = (over: Record<string, unknown> = {}) => ({
    federationId: FED,
    divisionId: DIV,
    weightClassId: WC,
    gender: 'Male',
    ...over,
  });

  let service: AthleteService;
  /** Queued results, one per `select ... limit`. Shifted in call order. */
  let selectResults: unknown[][];
  /** The `where` argument of every select, in call order. */
  let selectWheres: unknown[];
  let updateCalls: Array<{ table: unknown; patch: Record<string, unknown>; where: unknown }>;

  beforeEach(async () => {
    selectResults = [];
    selectWheres = [];
    updateCalls = [];

    /** The subset of the Drizzle builder `updateOwnProfile` walks. Declared as a
     * type so the self-referential `from: () => chain` is not inferred as `any`,
     * which ESLint reports as an unsafe return. */
    interface SelectChain {
      from: () => SelectChain;
      innerJoin: () => SelectChain;
      leftJoin: () => SelectChain;
      where: (condition: unknown) => SelectChain;
      limit: () => Promise<unknown[]>;
    }

    const db = {
      select: jest.fn().mockImplementation(() => {
        const chain: SelectChain = {
          from: jest.fn(() => chain),
          innerJoin: jest.fn(() => chain),
          leftJoin: jest.fn(() => chain),
          where: jest.fn((condition: unknown) => {
            selectWheres.push(condition);
            return chain;
          }),
          limit: jest.fn(() => Promise.resolve(selectResults.shift() ?? [])),
        };
        return chain;
      }),
      update: jest.fn().mockImplementation((table: unknown) => ({
        set: jest.fn((patch: Record<string, unknown>) => ({
          where: jest.fn((condition: unknown) => {
            updateCalls.push({ table, patch, where: condition });
            return Promise.resolve(undefined);
          }),
        })),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AthleteService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get<AthleteService>(AthleteService);
  });

  /** Every reference-data lookup after the row read reports a hit. */
  const allLookupsSucceed = (rows = currentRow()) => {
    selectResults = [[rows], [{ one: 1 }], [{ one: 1 }], [{ one: 1 }]];
  };

  it('scopes the read and the write to the id from the token', async () => {
    allLookupsSucceed();

    await service.updateOwnProfile({ federation_id: FED, division_id: DIV }, caller);

    // The row read, and the update, both pinned to the caller's own id.
    expect(selectWheres[0]).toEqual(eq(athletes.id, CALLER));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(athletes);
    expect(updateCalls[0].where).toEqual(eq(athletes.id, CALLER));
    // Belt and braces: it is not some other athlete's row that happens to pass.
    expect(updateCalls[0].where).not.toEqual(eq(athletes.id, OTHER));
  });

  /** The ValidationPipe rejects an undeclared field with a 400 before the service
   * is reached (`forbidNonWhitelisted`), so this is the second line of defence:
   * even handed a body with someone else's id in it, nothing but the three
   * declared columns reaches the `set`, and the target row does not move. */
  it('cannot be redirected by an id smuggled into the body', async () => {
    allLookupsSucceed();

    await service.updateOwnProfile(
      { id: OTHER, user_id: OTHER, federation_id: FED } as never,
      caller,
    );

    expect(updateCalls[0].patch).toEqual({ federationId: FED });
    expect(updateCalls[0].where).toEqual(eq(athletes.id, CALLER));
  });

  it('404s when the caller has no athletes row', async () => {
    selectResults = [[]];

    await expect(service.updateOwnProfile({ federation_id: FED }, caller)).rejects.toThrow(
      NotFoundException,
    );
    expect(updateCalls).toHaveLength(0);
  });

  /** An empty `set` is a Drizzle error, and there is nothing to authorize. */
  it('does nothing when the patch is empty', async () => {
    await service.updateOwnProfile({}, caller);

    expect(selectWheres).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('maps only the three declared columns', async () => {
    allLookupsSucceed();

    await service.updateOwnProfile(
      { federation_id: FED, division_id: DIV, weight_class_id: WC },
      caller,
    );

    expect(updateCalls[0].patch).toEqual({
      federationId: FED,
      divisionId: DIV,
      weightClassId: WC,
    });
  });

  it('clears a column when the field is explicitly null', async () => {
    allLookupsSucceed();

    await service.updateOwnProfile({ weight_class_id: null }, caller);

    expect(updateCalls[0].patch).toEqual({ weightClassId: null });
  });

  /** The point of merging: a PATCH of one field is checked against what is
   * already stored, so a division cannot be moved under a federation it does not
   * belong to one request at a time. */
  it('validates a division-only patch against the stored federation', async () => {
    // row read, federation exists, division lookup misses
    selectResults = [[currentRow()], [{ one: 1 }], []];

    await expect(service.updateOwnProfile({ division_id: DIV }, caller)).rejects.toThrow(
      'Division not found',
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects a division when neither the patch nor the row has a federation', async () => {
    selectResults = [[currentRow({ federationId: null })]];

    await expect(service.updateOwnProfile({ division_id: DIV }, caller)).rejects.toThrow(
      'Federation is required to validate division',
    );
  });

  /** Gender comes from the users row, never the request — a weight class is
   * (federation, gender, name), so a client able to assert its own gender here
   * could attach a men's class to a women's profile. */
  it('rejects a weight class when the users row has no gender', async () => {
    selectResults = [[currentRow({ gender: null })], [{ one: 1 }], [{ one: 1 }]];

    await expect(service.updateOwnProfile({ weight_class_id: WC }, caller)).rejects.toThrow(
      'Gender is required to validate weight class',
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects a federation that does not exist', async () => {
    selectResults = [[currentRow()], []];

    await expect(service.updateOwnProfile({ federation_id: FED }, caller)).rejects.toThrow(
      'Federation not found',
    );
    expect(updateCalls).toHaveLength(0);
  });
});

/** Who may search the athlete directory.
 *
 * ⚠️ This was ungated. `callerId` was used only to *exclude* athletes the caller
 * had already invited — it never established that the caller was a coach — so any
 * signed-in user could enumerate every athlete's name, username, federation and
 * weight class. The ids it returns were also step one of opening an unsolicited
 * conversation with any of them, which is the other half of the same hole.
 */
describe('AthleteService - searchAthletes', () => {
  const COACH = '11111111-1111-4111-8111-111111111111';
  const NOT_A_COACH = '22222222-2222-4222-8222-222222222222';

  let harness: TestDb;
  let service: AthleteService;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [AthleteService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<AthleteService>(AthleteService);
  }

  it('refuses a caller with no coaches row', async () => {
    await build({ coaches: [[]] });

    await expect(service.searchAthletes('smith', NOT_A_COACH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows a coach', async () => {
    await build({ coaches: [[{ id: COACH }]], users: [[]] });

    await expect(service.searchAthletes('smith', COACH)).resolves.toEqual([]);
  });

  /** ⚠️ The coach check must come **before** the empty-term short-circuit.
   * Otherwise a non-coach probing with an empty query gets a clean `[]` rather
   * than a refusal, which tells them the endpoint is open to them and is exactly
   * the kind of thing that gets "optimised" back the wrong way later. */
  it('checks the caller is a coach before short-circuiting on an empty term', async () => {
    await build({ coaches: [[]] });

    await expect(service.searchAthletes('   ', NOT_A_COACH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('issues no writes', async () => {
    await build({ coaches: [[{ id: COACH }]], users: [[]] });

    await service.searchAthletes('smith', COACH);

    expect(harness.writes).toHaveLength(0);
  });
});
