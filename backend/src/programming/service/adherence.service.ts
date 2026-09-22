import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import {
  athletes,
  coachAthleteRelationships,
  sets,
  users,
  workoutExercises,
  workouts,
} from 'src/db/schema';
import { DEFAULT_ADHERENCE_DAYS, MAX_ADHERENCE_DAYS } from '../dto/adherence-query.dto';

/** One athlete's adherence over the window. Raw counts rather than a percentage:
 * "8 of 12 sets" tells a coach something "67%" does not, and a client that wants
 * a percentage can divide. */
export interface AdherenceRow {
  athlete_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  workouts_assigned: number;
  workouts_started: number;
  sets_prescribed: number;
  sets_completed: number;
}

@Injectable()
export class AdherenceService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Who on the calling coach's roster is doing the work.
   *
   * **The coach's reason to open the app on a day they are not programming.**
   * Without it, a coach finds out an athlete stopped training when they ask.
   *
   * Authorization is the `WHERE` clause rather than a separate gate: the query
   * starts from `coach_athlete_relationships` scoped to the caller, so it is
   * structurally incapable of returning an athlete who is not theirs. There is no
   * id in the request to authorize, which is the safest shape available.
   */
  async listAdherence(days: number | undefined, callerId: string): Promise<AdherenceRow[]> {
    const window = Math.min(days ?? DEFAULT_ADHERENCE_DAYS, MAX_ADHERENCE_DAYS);

    const rows = await this.db
      .select({
        athlete_id: athletes.id,
        first_name: users.firstName,
        last_name: users.lastName,
        username: users.username,
        // ⚠️ `count(distinct)` is required. The left join through
        // workout_exercises → sets fans each workout out once per set, so a plain
        // count would report a three-set workout as three workouts.
        workouts_assigned: sql<number>`count(distinct ${workouts.id})::int`,
        workouts_started: sql<number>`count(distinct ${workouts.id}) filter (where ${sets.isCompleted})::int`,
        sets_prescribed: sql<number>`count(${sets.id})::int`,
        sets_completed: sql<number>`count(${sets.id}) filter (where ${sets.isCompleted})::int`,
      })
      .from(coachAthleteRelationships)
      .innerJoin(athletes, eq(athletes.id, coachAthleteRelationships.athleteId))
      .innerJoin(users, eq(users.id, athletes.id))
      // ⚠️ The window filter lives in the JOIN condition, not in WHERE. In WHERE it
      // would turn these left joins into inner ones and silently drop every athlete
      // with no workouts in the range — which is exactly the athlete a coach opens
      // this screen to find.
      .leftJoin(
        workouts,
        and(
          eq(workouts.athleteId, athletes.id),
          // ⚠️ The cast is required, not decoration. `current_date - $1` gives Postgres
          // no type to infer for the parameter and the whole query fails at execution
          // with an operator-resolution error — invisible to the mocked client, which
          // never sends SQL anywhere.
          gte(workouts.date, sql`current_date - cast(${window} as int)`),
          lte(workouts.date, sql`current_date`),
        ),
      )
      .leftJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
      .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
      .where(
        and(
          eq(coachAthleteRelationships.coachId, callerId),
          eq(coachAthleteRelationships.status, 'active'),
        ),
      )
      .groupBy(athletes.id, users.firstName, users.lastName, users.username);

    // Worst adherence first. A coach opens this to find who needs attention, not
    // to admire the athlete who did everything — so the default order should put
    // the answer at the top rather than make them scroll for it. An athlete with
    // nothing prescribed sorts last: they are not behind, they are unprogrammed.
    return rows.sort((a, b) => ratio(a) - ratio(b));
  }
}

function ratio(row: AdherenceRow): number {
  if (row.sets_prescribed === 0) return Number.POSITIVE_INFINITY;
  return row.sets_completed / row.sets_prescribed;
}
