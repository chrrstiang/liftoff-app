import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { athleteMaxes, exercises, sets, workoutExercises, workouts } from 'src/db/schema';
import { MAX_WINDOW_DAYS, effectiveMax, selectMaxEstimate, type LoggedSet } from './e1rm';
import { assertReadableAthlete, isActiveCoachOf } from './programming-access';

/** One max as the API reports it. `effective_value` is what prescription actually
 * resolves against; the two components are exposed beside it so a coach can see
 * whether a number is theirs or the app's. */
export interface MaxView {
  exercise_id: string;
  exercise_name: string;
  effective_value: number | null;
  override_value: number | null;
  computed_value: number | null;
  computed_at: Date | null;
  computed_from: string | null;
}

@Injectable()
export class MaxesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every max for one athlete.
   *
   * Read access is the **wide** rule — the athlete, or any active coach of them.
   * That is deliberate and matches the co-coach decision in docs/AUTHORIZATION.md:
   * a view-only head coach should be able to see the numbers their athlete is
   * being programmed against, even though they cannot change them.
   */
  async listMaxes(athleteId: string, callerId: string): Promise<MaxView[]> {
    await assertReadableAthlete(this.db, athleteId, callerId);

    const rows = await this.db
      .select({
        exercise_id: athleteMaxes.exerciseId,
        exercise_name: exercises.name,
        override_value: athleteMaxes.overrideValue,
        computed_value: athleteMaxes.computedValue,
        computed_at: athleteMaxes.computedAt,
        computed_from: athleteMaxes.computedFrom,
      })
      .from(athleteMaxes)
      .innerJoin(exercises, eq(exercises.id, athleteMaxes.exerciseId))
      .where(eq(athleteMaxes.athleteId, athleteId))
      .orderBy(exercises.name);

    return rows.map((row) => ({ ...row, effective_value: effectiveMax(row) }));
  }

  /** Pins or clears a coach's override.
   *
   * **Writing a max is programming**, so it is coach-only — an athlete who could
   * set their own max could rewrite every percentage they are prescribed. That is
   * why this checks `isActiveCoachOf` rather than `assertReadableAthlete`, which
   * would also admit the athlete themselves.
   *
   * A caller with no claim gets a 404 rather than a 403, matching the rest of the
   * codebase: a 403 would confirm the athlete id names someone real.
   */
  async setOverride(
    athleteId: string,
    exerciseId: string,
    value: number | null,
    callerId: string,
  ): Promise<MaxView> {
    await this.assertCoachOf(athleteId, callerId);
    await this.assertExerciseInCallersLibrary(exerciseId, callerId);

    // Upsert rather than select-then-branch: the unique index on
    // (athlete_id, exercise_id) makes this atomic, so two coaches pinning at once
    // cannot produce two rows.
    await this.db
      .insert(athleteMaxes)
      .values({ athleteId, exerciseId, overrideValue: value })
      .onConflictDoUpdate({
        target: [athleteMaxes.athleteId, athleteMaxes.exerciseId],
        set: { overrideValue: value },
      });

    const [view] = await this.listMaxesFor(athleteId, [exerciseId]);
    return view;
  }

  /** Recomputes derived maxes from logged sets.
   *
   * Coach-triggered rather than automatic. A max that moved on every logged set
   * would re-scale Wednesday's squats because Monday was strong, which is
   * instability rather than autoregulation — see docs/MAXES-DESIGN.md section 2.3.
   *
   * Omitting `exerciseId` refreshes everything the athlete has logged work on,
   * which is what starting a new block wants.
   */
  async refresh(athleteId: string, exerciseId: string | undefined, callerId: string) {
    await this.assertCoachOf(athleteId, callerId);

    const logged = await this.loggedSetsFor(athleteId, exerciseId);

    // Group by exercise first: the estimate is per-exercise, because each
    // variation carries its own max.
    const byExercise = new Map<string, LoggedSet[]>();
    for (const row of logged) {
      const bucket = byExercise.get(row.exercise_id);
      if (bucket) bucket.push(row.set);
      else byExercise.set(row.exercise_id, [row.set]);
    }

    const now = new Date();
    const refreshed: string[] = [];

    for (const [id, loggedSets] of byExercise) {
      const estimate = selectMaxEstimate(loggedSets, now);
      if (!estimate) continue;

      await this.db
        .insert(athleteMaxes)
        .values({
          athleteId,
          exerciseId: id,
          computedValue: estimate.value,
          computedAt: now,
          computedFrom: estimate.fromSetId,
        })
        .onConflictDoUpdate({
          target: [athleteMaxes.athleteId, athleteMaxes.exerciseId],
          // Deliberately does NOT touch override_value. A refresh recomputes the
          // app's number; it never clears the coach's pin.
          set: {
            computedValue: estimate.value,
            computedAt: now,
            computedFrom: estimate.fromSetId,
          },
        });

      refreshed.push(id);
    }

    return { refreshed: refreshed.length, maxes: await this.listMaxesFor(athleteId, refreshed) };
  }

  /** The effective max per exercise, for resolving percentage prescriptions.
   *
   * Returns a Map so a workout read resolves every set from one query rather than
   * one per set.
   */
  async effectiveMaxesFor(
    athleteId: string,
    exerciseIds: string[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (!exerciseIds.length) return result;

    const rows = await this.db
      .select({
        exercise_id: athleteMaxes.exerciseId,
        override_value: athleteMaxes.overrideValue,
        computed_value: athleteMaxes.computedValue,
      })
      .from(athleteMaxes)
      .where(
        and(eq(athleteMaxes.athleteId, athleteId), inArray(athleteMaxes.exerciseId, exerciseIds)),
      );

    for (const row of rows) {
      result.set(row.exercise_id, effectiveMax(row));
    }

    return result;
  }

  private async listMaxesFor(athleteId: string, exerciseIds: string[]): Promise<MaxView[]> {
    if (!exerciseIds.length) return [];

    const rows = await this.db
      .select({
        exercise_id: athleteMaxes.exerciseId,
        exercise_name: exercises.name,
        override_value: athleteMaxes.overrideValue,
        computed_value: athleteMaxes.computedValue,
        computed_at: athleteMaxes.computedAt,
        computed_from: athleteMaxes.computedFrom,
      })
      .from(athleteMaxes)
      .innerJoin(exercises, eq(exercises.id, athleteMaxes.exerciseId))
      .where(
        and(eq(athleteMaxes.athleteId, athleteId), inArray(athleteMaxes.exerciseId, exerciseIds)),
      )
      .orderBy(exercises.name);

    return rows.map((row) => ({ ...row, effective_value: effectiveMax(row) }));
  }

  /** Every logged set for this athlete, within the estimate window.
   *
   * Bounded by the window in SQL rather than in JS: an athlete with a season of
   * training would otherwise pull every set they have ever logged in order to
   * discard all but the last four weeks.
   */
  private async loggedSetsFor(athleteId: string, exerciseId: string | undefined) {
    const cutoff = new Date(Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        exercise_id: workoutExercises.exerciseId,
        id: sets.id,
        actual_load: sets.actualLoad,
        prescribed_reps: sets.prescribedReps,
        actual_intensity: sets.actualIntensity,
        created_at: sets.createdAt,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.athleteId, athleteId),
          gte(sets.createdAt, cutoff),
          isNotNull(sets.actualLoad),
          isNotNull(sets.actualIntensity),
          exerciseId ? eq(workoutExercises.exerciseId, exerciseId) : undefined,
        ),
      )
      .orderBy(desc(sets.createdAt));

    return rows.map((row) => ({
      exercise_id: row.exercise_id,
      set: {
        id: row.id,
        actual_load: row.actual_load,
        prescribed_reps: row.prescribed_reps,
        actual_intensity: row.actual_intensity,
        created_at: row.created_at,
      } satisfies LoggedSet,
    }));
  }

  /** 404 rather than 403 for a caller with no claim, per the rule throughout this
   * codebase: a 403 would confirm the athlete id names someone real. */
  private async assertCoachOf(athleteId: string, callerId: string): Promise<void> {
    if (!(await isActiveCoachOf(this.db, callerId, athleteId))) {
      throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
    }
  }

  /** A coach may only pin maxes against their own library.
   *
   * Without this a coach could write an `athlete_maxes` row for another coach's
   * exercise — harmless today, but it would put a number on a screen the writing
   * coach cannot see, which is the kind of thing nobody can debug later.
   */
  private async assertExerciseInCallersLibrary(
    exerciseId: string,
    callerId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, exerciseId), eq(exercises.createdBy, callerId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Exercise with ID ${exerciseId} could not be found`);
    }
  }
}
