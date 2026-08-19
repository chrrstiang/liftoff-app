import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AthleteService } from './athlete.service';
import { DRIZZLE } from 'src/db/db.module';

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
