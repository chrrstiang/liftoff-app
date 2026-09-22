import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from 'src/db/db.module';
import { makeTestDb, type TestDb } from 'src/db/testing/db-mock';
import { MaxesService } from './maxes.service';

/** Authorization and precedence for maxes.
 *
 * ⚠️ The shared Drizzle double routes results by table and **ignores `where`**, so
 * these specs cannot prove a query was scoped. What they can prove is which
 * *checks ran* — a caller with no relationship row gets a 404 before any read of
 * `athlete_maxes` happens at all, which is the gate that matters. The row-level
 * scoping is asserted in the e2e suite against a real database.
 */
describe('MaxesService', () => {
  const ATHLETE = '22222222-2222-4222-8222-222222222222';
  const COACH = '11111111-1111-4111-8111-111111111111';
  const STRANGER = '44444444-4444-4444-8444-444444444444';
  const EXERCISE = '55555555-5555-4555-8555-555555555555';

  let harness: TestDb;
  let service: MaxesService;

  async function build(script: Parameters<typeof makeTestDb>[0]) {
    harness = makeTestDb(script);

    const module: TestingModule = await Test.createTestingModule({
      providers: [MaxesService, { provide: DRIZZLE, useValue: harness.db }],
    }).compile();

    service = module.get<MaxesService>(MaxesService);
  }

  /** An active relationship row. Only its presence matters to the double. */
  const RELATIONSHIP = [{ id: 'rel' }];

  describe('listMaxes', () => {
    it('lets an athlete read their own maxes', async () => {
      await build({
        athlete_maxes: [
          [
            {
              exercise_id: EXERCISE,
              exercise_name: 'Comp Squat',
              override_value: null,
              computed_value: 180,
              computed_at: new Date(),
              computed_from: 'set-1',
            },
          ],
        ],
      });

      const result = await service.listMaxes(ATHLETE, ATHLETE);

      expect(result).toHaveLength(1);
      expect(result[0].effective_value).toBe(180);
    });

    /** The **wide** read rule, matching the co-coach decision: a view-only head
     * coach should see the numbers their athlete is programmed against even though
     * they cannot change them. */
    it('lets any active coach of the athlete read them', async () => {
      await build({ coach_athlete_relationships: [RELATIONSHIP], athlete_maxes: [[]] });

      await expect(service.listMaxes(ATHLETE, COACH)).resolves.toEqual([]);
    });

    it('404s a caller with no claim on the athlete', async () => {
      await build({ coach_athlete_relationships: [[]], athlete_maxes: [[]] });

      await expect(service.listMaxes(ATHLETE, STRANGER)).rejects.toBeInstanceOf(NotFoundException);
    });

    /** `override_value ?? computed_value`, surfaced so the client does not have to
     * reimplement the precedence. */
    it('reports the override as the effective value when one is pinned', async () => {
      await build({
        athlete_maxes: [
          [
            {
              exercise_id: EXERCISE,
              exercise_name: 'Comp Squat',
              override_value: 200,
              computed_value: 180,
              computed_at: new Date(),
              computed_from: 'set-1',
            },
          ],
        ],
      });

      const [row] = await service.listMaxes(ATHLETE, ATHLETE);

      expect(row.effective_value).toBe(200);
      expect(row.computed_value).toBe(180);
    });
  });

  describe('setOverride', () => {
    /** ⚠️ **Writing a max is programming.** An athlete who could set their own max
     * would be rewriting every percentage they are prescribed, which is the whole
     * point of the prescription being the coach's. So this uses the *narrow* rule
     * even though reads use the wide one. */
    it('refuses the athlete setting their own max', async () => {
      await build({ coach_athlete_relationships: [[]] });

      await expect(service.setOverride(ATHLETE, EXERCISE, 200, ATHLETE)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(harness.writes).toHaveLength(0);
    });

    it('refuses a coach with no relationship, without writing', async () => {
      await build({ coach_athlete_relationships: [[]] });

      await expect(service.setOverride(ATHLETE, EXERCISE, 200, STRANGER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(harness.writes).toHaveLength(0);
    });

    /** A coach may only pin against their own library. Otherwise a max would sit
     * against an exercise the writing coach cannot see, which nobody could debug
     * later. */
    it('refuses an exercise outside the calling coach’s library', async () => {
      await build({ coach_athlete_relationships: [RELATIONSHIP], exercises: [[]] });

      await expect(service.setOverride(ATHLETE, EXERCISE, 200, COACH)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(harness.writes).toHaveLength(0);
    });

    it('writes the override for a coach of the athlete', async () => {
      await build({
        coach_athlete_relationships: [RELATIONSHIP],
        exercises: [[{ id: EXERCISE }]],
        // Two entries: the upsert consumes one from this table's queue before the
        // read-back does. The double keys results by table, and an insert is a
        // chain against the same table.
        athlete_maxes: [
          [],
          [
            {
              exercise_id: EXERCISE,
              exercise_name: 'Comp Squat',
              override_value: 200,
              computed_value: null,
              computed_at: null,
              computed_from: null,
            },
          ],
        ],
      });

      const result = await service.setOverride(ATHLETE, EXERCISE, 200, COACH);

      expect(harness.writes.some((w) => w.table === 'athlete_maxes')).toBe(true);
      expect(result.effective_value).toBe(200);
    });

    /** null clears the pin and hands control back to the derived value — distinct
     * from omitting the field, which the DTO rejects. */
    it('accepts null to clear a pinned override', async () => {
      await build({
        coach_athlete_relationships: [RELATIONSHIP],
        exercises: [[{ id: EXERCISE }]],
        athlete_maxes: [[]],
      });

      await service.setOverride(ATHLETE, EXERCISE, null, COACH);

      const write = harness.writes.find((w) => w.table === 'athlete_maxes');
      expect(write).toBeDefined();
      expect(write!.values).toMatchObject({ overrideValue: null });
    });
  });

  describe('refresh', () => {
    it('refuses a caller who does not coach the athlete', async () => {
      await build({ coach_athlete_relationships: [[]] });

      await expect(service.refresh(ATHLETE, undefined, STRANGER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(harness.writes).toHaveLength(0);
    });

    /** Nothing to estimate from is the normal state early on, not an error. */
    it('writes nothing when no logged set can be estimated from', async () => {
      await build({ coach_athlete_relationships: [RELATIONSHIP], sets: [[]] });

      const result = await service.refresh(ATHLETE, undefined, COACH);

      expect(result.refreshed).toBe(0);
      expect(harness.writes).toHaveLength(0);
    });

    it('derives and stores a max from a logged set', async () => {
      await build({
        coach_athlete_relationships: [RELATIONSHIP],
        sets: [
          [
            {
              exercise_id: EXERCISE,
              id: 'set-1',
              actual_load: 100,
              prescribed_reps: 3,
              actual_intensity: 8,
              created_at: new Date(),
            },
          ],
        ],
        athlete_maxes: [
          [
            {
              exercise_id: EXERCISE,
              exercise_name: 'Comp Squat',
              override_value: null,
              computed_value: 116.667,
              computed_at: new Date(),
              computed_from: 'set-1',
            },
          ],
        ],
      });

      const result = await service.refresh(ATHLETE, undefined, COACH);

      expect(result.refreshed).toBe(1);
      const write = harness.writes.find((w) => w.table === 'athlete_maxes');
      expect(write!.values).toMatchObject({ computedFrom: 'set-1' });
    });

    /** ⚠️ A refresh recomputes the app's number. It must never clear the coach's
     * pin — a coach who overrode a max and then hit refresh would otherwise lose
     * the override silently. */
    it('never writes override_value on a refresh', async () => {
      await build({
        coach_athlete_relationships: [RELATIONSHIP],
        sets: [
          [
            {
              exercise_id: EXERCISE,
              id: 'set-1',
              actual_load: 100,
              prescribed_reps: 3,
              actual_intensity: 8,
              created_at: new Date(),
            },
          ],
        ],
        athlete_maxes: [[]],
      });

      await service.refresh(ATHLETE, undefined, COACH);

      const write = harness.writes.find((w) => w.table === 'athlete_maxes');
      expect(write!.values).not.toHaveProperty('overrideValue');
    });
  });

  describe('effectiveMaxesFor', () => {
    /** Called on every workout read, so an empty exercise list must not issue a
     * query with an empty `IN ()`, which Postgres rejects. */
    it('returns an empty map without querying when given no exercises', async () => {
      await build({});

      await expect(service.effectiveMaxesFor(ATHLETE, [])).resolves.toEqual(new Map());
    });

    it('maps each exercise to its effective max', async () => {
      await build({
        athlete_maxes: [[{ exercise_id: EXERCISE, override_value: null, computed_value: 180 }]],
      });

      const result = await service.effectiveMaxesFor(ATHLETE, [EXERCISE]);

      expect(result.get(EXERCISE)).toBe(180);
    });
  });
});
