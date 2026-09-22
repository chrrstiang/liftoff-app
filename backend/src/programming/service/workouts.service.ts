import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { resolvePrescribedLoad } from './e1rm';
import { MaxesService } from './maxes.service';
import { athletes, coaches, exercises, sets, workoutExercises, workouts } from 'src/db/schema';
import type { CreateWorkoutDto } from '../dto/create-workout.dto';
import type { AddWorkoutExerciseDto } from '../dto/add-workout-exercise.dto';
import type { UpdateSetDto } from '../dto/update-set.dto';
import { resolveHistoryWindow, type HistoryQueryDto } from '../dto/history-query.dto';
import type { AssignWorkoutDto } from '../dto/assign-workout.dto';
import {
  assertReadableAthlete,
  historyVisibilityFilter,
  isActiveCoachOf,
  isPerformer,
  loadProgrammableWorkout,
  loadReadableWorkout,
  loadSetOwners,
} from './programming-access';

/** Workouts, their exercises, and set logging.
 *
 * ⚠️ **No RLS.** See programming-access.ts — every authorization rule for this
 * module lives there, and this service is not allowed to reach past it.
 */
@Injectable()
export class WorkoutsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly maxes: MaxesService,
  ) {}

  /** One workout with its exercises and sets, nested and ordered.
   *
   * Two queries, not one per exercise. The obvious shape — fetch exercises, then
   * loop fetching sets — is the N+1 the Supabase client hid behind its nested
   * select syntax; at 8 exercises that is 9 round trips to another subnet.
   *
   * Ordering is done in SQL. The old client sorted `workout_exercises` by `order`
   * and sets by `set_number` in JavaScript *after* the fetch, and crashed on a
   * workout with no exercises because it sorted before checking the error.
   */
  async findWorkout(workoutId: string, callerId: string) {
    await loadReadableWorkout(this.db, workoutId, callerId);

    const [workout] = await this.db
      .select({
        id: workouts.id,
        athlete_id: workouts.athleteId,
        coach_id: workouts.coachId,
        name: workouts.name,
        date: workouts.date,
        notes: workouts.notes,
        is_template: workouts.isTemplate,
        created_at: workouts.createdAt,
      })
      .from(workouts)
      .where(eq(workouts.id, workoutId))
      .limit(1);

    const exerciseRows = await this.db
      .select({
        id: workoutExercises.id,
        name: workoutExercises.displayName,
        order: workoutExercises.order,
        notes: workoutExercises.notes,
        exercise_id: exercises.id,
        exercise_name: exercises.name,
      })
      .from(workoutExercises)
      .innerJoin(exercises, eq(exercises.id, workoutExercises.exerciseId))
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(asc(workoutExercises.order));

    const setRows = exerciseRows.length
      ? await this.db
          .select({
            id: sets.id,
            workout_exercise_id: sets.workoutExerciseId,
            set_number: sets.setNumber,
            prescribed_reps: sets.prescribedReps,
            prescribed_intensity: sets.prescribedIntensity,
            prescribed_percent: sets.prescribedPercent,
            suggested_load_min: sets.suggestedLoadMin,
            suggested_load_max: sets.suggestedLoadMax,
            actual_load: sets.actualLoad,
            actual_intensity: sets.actualIntensity,
            is_completed: sets.isCompleted,
          })
          .from(sets)
          .where(
            inArray(
              sets.workoutExerciseId,
              exerciseRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(sets.setNumber))
      : [];

    const setsByExercise = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const bucket = setsByExercise.get(set.workout_exercise_id);
      if (bucket) bucket.push(set);
      else setsByExercise.set(set.workout_exercise_id, [set]);
    }

    /** Percentage prescriptions resolve here rather than being stored, so a
     * refreshed max re-scales work already written. One query for every exercise
     * in the workout, not one per set.
     *
     * Templates have no athlete (`athlete_id` is null), so there is nobody whose
     * max to resolve against — their percentages render unresolved, which is
     * correct: a template is not for anyone yet. */
    const maxes = workout.athlete_id
      ? await this.maxes.effectiveMaxesFor(
          workout.athlete_id,
          exerciseRows.map((e) => e.exercise_id),
        )
      : new Map<string, number | null>();

    return {
      ...workout,
      workout_exercises: exerciseRows.map((row) => ({
        id: row.id,
        // display_name is nullable; fall back to the library name so the client
        // never has to render an empty exercise heading.
        name: row.name ?? row.exercise_name,
        order: row.order,
        notes: row.notes,
        exercise: { id: row.exercise_id, name: row.exercise_name },
        sets: (setsByExercise.get(row.id) ?? []).map((set) => ({
          ...set,
          /** Null when the athlete has no max for this exercise yet. Not an
           * error — the client renders "75% — no max yet". Prescribing
           * percentages before there is data is a normal first block. */
          resolved_load: resolvePrescribedLoad(
            set.prescribed_percent,
            maxes.get(row.exercise_id) ?? null,
          ),
        })),
      })),
    };
  }

  /** An athlete's assigned workouts, newest last.
   *
   * Readable by the athlete themselves and by any coach with an active
   * relationship. Templates are excluded — they belong to a coach's library, not
   * to anyone's calendar, and `athlete_id` is null on them anyway.
   *
   * This does not apply `historyVisibilityFilter`, and no longer needs to: as of
   * 2026-09-20 that filter scopes to the athlete and nothing more, so the two
   * reads finally agree. They disagreed for exactly one release — this one showed
   * every coach's workouts while history showed only your own — which is why the
   * rule now lives in one named function instead of a `where` clause per query.
   */
  async listAthleteWorkouts(athleteId: string, callerId: string) {
    // 404, not 403: a 403 here confirms which user ids are athletes.
    await assertReadableAthlete(this.db, athleteId, callerId);

    return this.db
      .select({
        id: workouts.id,
        name: workouts.name,
        date: workouts.date,
      })
      .from(workouts)
      .where(eq(workouts.athleteId, athleteId))
      .orderBy(asc(workouts.date));
  }

  /** An athlete's **past** workouts, newest first, one page at a time.
   *
   * A route of its own rather than a mode of `GET /workouts`. That one returns
   * every assigned workout in ascending date order and both of its callers consume
   * the whole array to work out what comes next, so wrapping it in a paginated
   * envelope would silently truncate that to the oldest 20 workouts. The two reads
   * also disagree on everything that matters — direction, bound, and whether a
   * summary of what was logged is wanted — so they are two queries wearing one
   * name at best.
   *
   * Authorization is two things, and both are still needed. `assertReadableAthlete`
   * is the gate — `athlete_id` comes from the query string, so a caller with no
   * claim on it gets a 404 before a row is read. `historyVisibilityFilter` is the
   * row scope, and it now **matches** the gate rather than narrowing it: anyone who
   * may read this athlete may read all of their sessions, whoever authored them.
   *
   * The gate still has to run. Without it the filter alone would return an empty
   * list for a stranger, which answers "is this user training with me?" for any id
   * — the leak the 404 exists to prevent.
   */
  async listWorkoutHistory(query: HistoryQueryDto, callerId: string) {
    const athleteId = query.athlete_id;
    await assertReadableAthlete(this.db, athleteId, callerId);

    const { before, limit, offset } = resolveHistoryWindow(query);

    // `limit + 1` rather than a second `count(*)`: the only question the client
    // asks is whether another page exists, and one extra row answers it.
    //
    // The sort is fully deterministic — date, then created_at, then id. Two
    // workouts on the same day are common (a coach programming a morning and an
    // evening session), and with an ambiguous sort, offset pagination can show the
    // same workout on two pages and skip a third.
    const rows = await this.db
      .select({
        id: workouts.id,
        name: workouts.name,
        date: workouts.date,
        notes: workouts.notes,
      })
      .from(workouts)
      .where(and(historyVisibilityFilter(athleteId), lt(workouts.date, before)))
      .orderBy(desc(workouts.date), desc(workouts.createdAt), desc(workouts.id))
      .limit(limit + 1)
      .offset(offset);

    const page = rows.slice(0, limit);

    return {
      workouts: page.length ? await this.withSetTotals(page) : [],
      limit,
      offset,
      has_more: rows.length > limit,
    };
  }

  /** Every set an athlete has logged for one exercise, grouped by session and
   * newest session first. The "what did I squat last week" query.
   *
   * Paginated over **sessions**, not sets. Capping a flat list of sets would cut
   * the oldest session in half and render as a session where three sets were
   * performed instead of five, which is worse than not showing it.
   *
   * An exercise id that does not exist, or belongs to another coach's library,
   * comes back as an empty list rather than a 404. Every row returned is reached
   * through `historyVisibilityFilter`, so a foreign id cannot match anything — and
   * "you have never done this" and "no such exercise" being indistinguishable is
   * the desired answer, not a gap.
   *
   * Scoped by the same gate-plus-filter pair as `listWorkoutHistory`, so a coach
   * sees the athlete's full progression on this lift, including sessions another
   * of their coaches wrote. See `historyVisibilityFilter`.
   */
  async listExerciseHistory(exerciseId: string, query: HistoryQueryDto, callerId: string) {
    const athleteId = query.athlete_id;
    await assertReadableAthlete(this.db, athleteId, callerId);

    const { before, limit, offset } = resolveHistoryWindow(query);

    // `group by` is doing the work of `distinct` here: an exercise can appear
    // twice in one workout (two workout_exercises rows for a top set and back-off
    // sets), which would otherwise return that session twice and corrupt the page
    // boundaries. Both ordering columns are grouped, so the sort is legal.
    const sessionRows = await this.db
      .select({
        id: workouts.id,
        name: workouts.name,
        date: workouts.date,
      })
      .from(workouts)
      .innerJoin(workoutExercises, eq(workoutExercises.workoutId, workouts.id))
      .where(
        and(
          historyVisibilityFilter(athleteId),
          eq(workoutExercises.exerciseId, exerciseId),
          lt(workouts.date, before),
        ),
      )
      .groupBy(workouts.id, workouts.name, workouts.date)
      .orderBy(desc(workouts.date), desc(workouts.id))
      .limit(limit + 1)
      .offset(offset);

    const page = sessionRows.slice(0, limit);
    const hasMore = sessionRows.length > limit;

    if (!page.length) {
      return { sessions: [], limit, offset, has_more: false };
    }

    // Scoped by the ids the authorized query above returned, and filtered by the
    // same `exercise_id` — without that second clause this would return every set
    // of every exercise in those sessions.
    const setRows = await this.db
      .select({
        id: sets.id,
        workout_id: workoutExercises.workoutId,
        set_number: sets.setNumber,
        prescribed_reps: sets.prescribedReps,
        prescribed_intensity: sets.prescribedIntensity,
        prescribed_percent: sets.prescribedPercent,
        suggested_load_min: sets.suggestedLoadMin,
        suggested_load_max: sets.suggestedLoadMax,
        actual_load: sets.actualLoad,
        actual_intensity: sets.actualIntensity,
        is_completed: sets.isCompleted,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .where(
        and(
          inArray(
            workoutExercises.workoutId,
            page.map((session) => session.id),
          ),
          eq(workoutExercises.exerciseId, exerciseId),
        ),
      )
      .orderBy(asc(workoutExercises.order), asc(sets.setNumber));

    /** Resolve percentages here too, not only on the single-workout read.
     *
     * Review caught this: selecting `prescribed_percent` without resolving it
     * meant the same set carried a `resolved_load` through `GET /workouts/:id`
     * and a bare `75` through exercise history — two shapes for one row, which a
     * client would have to special-case. Exercise history is scoped to one
     * exercise, so this is a single max lookup rather than a per-set query. */
    const maxForExercise = (await this.maxes.effectiveMaxesFor(athleteId, [exerciseId])).get(
      exerciseId,
    );

    const setsByWorkout = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const bucket = setsByWorkout.get(set.workout_id);
      if (bucket) bucket.push(set);
      else setsByWorkout.set(set.workout_id, [set]);
    }

    return {
      sessions: page.map((session) => ({
        workout_id: session.id,
        workout_name: session.name,
        date: session.date,
        sets: (setsByWorkout.get(session.id) ?? []).map((set) => ({
          ...set,
          resolved_load: resolvePrescribedLoad(set.prescribed_percent, maxForExercise ?? null),
        })),
      })),
      limit,
      offset,
      has_more: hasMore,
    };
  }

  /** Annotates a page of workouts with how much was in them and how much got done.
   *
   * Counted in JavaScript from one flat read rather than with
   * `count(...) filter (where ...)` in SQL. The page is capped at
   * `MAX_HISTORY_LIMIT` workouts, so the row count is bounded and small, and the
   * aggregation is then something a unit spec can actually assert — a mocked
   * Drizzle cannot tell a correct aggregate expression from a malformed one.
   *
   * The join is a `leftJoin` so a workout whose exercises have no sets still
   * reports its exercise count instead of vanishing from the summary.
   */
  private async withSetTotals<T extends { id: string }>(page: T[]) {
    const rows = await this.db
      .select({
        workout_id: workoutExercises.workoutId,
        workout_exercise_id: workoutExercises.id,
        set_id: sets.id,
        is_completed: sets.isCompleted,
      })
      .from(workoutExercises)
      .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
      .where(
        inArray(
          workoutExercises.workoutId,
          page.map((workout) => workout.id),
        ),
      );

    const totals = new Map<
      string,
      { exercises: Set<string>; setCount: number; completedCount: number }
    >();

    for (const row of rows) {
      let entry = totals.get(row.workout_id);
      if (!entry) {
        entry = { exercises: new Set<string>(), setCount: 0, completedCount: 0 };
        totals.set(row.workout_id, entry);
      }

      entry.exercises.add(row.workout_exercise_id);

      // Null on the set side means the left join found no sets, not a set with no
      // id — counting it would report a phantom set on an empty exercise.
      if (row.set_id) {
        entry.setCount += 1;
        if (row.is_completed) entry.completedCount += 1;
      }
    }

    return page.map((workout) => {
      const entry = totals.get(workout.id);

      return {
        ...workout,
        exercise_count: entry ? entry.exercises.size : 0,
        set_count: entry ? entry.setCount : 0,
        completed_set_count: entry ? entry.completedCount : 0,
      };
    });
  }

  /** The calling coach's template library, with prescriptions but no logged values.
   *
   * A template is a workout with **no athlete**. The old query filtered
   * `is_template = true`, but nothing ever wrote that column, so it was NULL on
   * every row — and `= true` does not match NULL. The template list was therefore
   * always empty, for everyone, since the feature shipped. `createWorkout` now
   * writes the column, and this filters on `athlete_id is null` as well so the rows
   * that predate the fix still appear.
   */
  async listTemplates(callerId: string) {
    const templates = await this.db
      .select({
        id: workouts.id,
        name: workouts.name,
        notes: workouts.notes,
      })
      .from(workouts)
      .where(and(eq(workouts.coachId, callerId), isNull(workouts.athleteId)))
      .orderBy(desc(workouts.createdAt));

    if (!templates.length) return [];

    const exerciseRows = await this.db
      .select({
        id: workoutExercises.id,
        workout_id: workoutExercises.workoutId,
        name: workoutExercises.displayName,
        order: workoutExercises.order,
        notes: workoutExercises.notes,
        exercise_id: exercises.id,
        exercise_name: exercises.name,
      })
      .from(workoutExercises)
      .innerJoin(exercises, eq(exercises.id, workoutExercises.exerciseId))
      .where(
        inArray(
          workoutExercises.workoutId,
          templates.map((t) => t.id),
        ),
      )
      .orderBy(asc(workoutExercises.order));

    const setRows = exerciseRows.length
      ? await this.db
          .select({
            id: sets.id,
            workout_exercise_id: sets.workoutExerciseId,
            set_number: sets.setNumber,
            prescribed_reps: sets.prescribedReps,
            prescribed_intensity: sets.prescribedIntensity,
            /** A template carries its percentages, and the hand-typed loads
             * beside them.
             *
             * Without these, a coach who built a template around "5x3 @ 75%" and
             * then applied it would get bare rep counts — the prescription
             * silently dropped at the moment it was reused, which is the one
             * moment a template exists for. Matters twice over because bulk
             * assign (roadmap item 3) applies templates to a whole roster.
             *
             * Templates have no athlete, so there is no max to resolve against
             * here; the percentage travels and resolves once the workout is
             * assigned to someone. */
            prescribed_percent: sets.prescribedPercent,
            suggested_load_min: sets.suggestedLoadMin,
            suggested_load_max: sets.suggestedLoadMax,
          })
          .from(sets)
          .where(
            inArray(
              sets.workoutExerciseId,
              exerciseRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(sets.setNumber))
      : [];

    const setsByExercise = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const bucket = setsByExercise.get(set.workout_exercise_id);
      if (bucket) bucket.push(set);
      else setsByExercise.set(set.workout_exercise_id, [set]);
    }

    return templates.map((template) => ({
      ...template,
      workout_exercises: exerciseRows
        .filter((row) => row.workout_id === template.id)
        .map((row) => ({
          id: row.id,
          name: row.name ?? row.exercise_name,
          order: row.order,
          notes: row.notes,
          exercise: { id: row.exercise_id, name: row.exercise_name },
          sets: setsByExercise.get(row.id) ?? [],
        })),
    }));
  }

  /** Creates a workout with all its exercises and sets in **one transaction**.
   *
   * The client version issued 1 + 2N inserts with no transaction, so a failure on
   * exercise 4 of 6 left a half-built workout that the athlete could open and
   * start logging against. There was no way to tell that state from a workout the
   * coach meant to leave short.
   *
   * `is_template` is derived, not accepted: a workout is a template exactly when it
   * has no athlete. Taking it from the body admits the contradictory row
   * `is_template = true` with an `athlete_id`, and there is no sound way to
   * interpret that — is it assigned or is it library? Deriving makes the invariant
   * hold by construction.
   */
  async createWorkout(dto: CreateWorkoutDto, callerId: string) {
    const [isCoach] = await this.db
      .select({ id: coaches.id })
      .from(coaches)
      .where(eq(coaches.id, callerId))
      .limit(1);

    if (!isCoach) {
      throw new ForbiddenException('Only a coach can create a workout');
    }

    const athleteId = dto.athlete_id ?? null;

    if (athleteId !== null) {
      const [athlete] = await this.db
        .select({ id: athletes.id })
        .from(athletes)
        .where(eq(athletes.id, athleteId))
        .limit(1);

      if (!athlete) {
        throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
      }

      // The rule that stops a coach programming for someone else's athlete. On
      // Supabase nothing checked this at all.
      if (!(await isActiveCoachOf(this.db, callerId, athleteId))) {
        throw new ForbiddenException('This athlete is not on your roster');
      }
    }

    // Every referenced exercise must exist and belong to the calling coach's
    // library. Checked in one query before the transaction opens — a clean 400
    // beats an aborted transaction and an opaque foreign-key error.
    const requestedExerciseIds = [...new Set(dto.exercises.map((e) => e.exercise_id))];
    const known = await this.db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(inArray(exercises.id, requestedExerciseIds), eq(exercises.createdBy, callerId)));

    const knownIds = new Set(known.map((e) => e.id));
    const unknown = requestedExerciseIds.filter((id) => !knownIds.has(id));

    if (unknown.length) {
      throw new BadRequestException(`Unknown exercise: '${unknown.join("', '")}'`);
    }

    assertDistinctSetNumbers(dto.exercises);

    return this.db.transaction(async (tx) => {
      const [workout] = await tx
        .insert(workouts)
        .values({
          name: dto.name,
          date: dto.date,
          notes: dto.notes ?? null,
          athleteId,
          coachId: callerId,
          isTemplate: athleteId === null,
        })
        .returning({ id: workouts.id });

      // One insert for all the exercises, then one for all the sets. The sets
      // cannot be batched until the exercise ids exist, so two statements is the
      // floor here regardless of how many exercises there are.
      const insertedExercises = await tx
        .insert(workoutExercises)
        .values(
          dto.exercises.map((exercise) => ({
            workoutId: workout.id,
            exerciseId: exercise.exercise_id,
            displayName: exercise.display_name ?? null,
            order: exercise.order,
            notes: exercise.notes ?? null,
          })),
        )
        .returning({ id: workoutExercises.id, order: workoutExercises.order });

      // `returning` preserves the order rows were supplied in, but pairing by
      // index would silently mis-assign every set if that ever stopped holding.
      // Match on `order`, which is unique per workout after the check above.
      const byOrder = new Map(insertedExercises.map((row) => [row.order, row.id]));

      await tx.insert(sets).values(
        dto.exercises.flatMap((exercise) =>
          exercise.sets.map((set) => ({
            workoutExerciseId: byOrder.get(exercise.order)!,
            setNumber: set.set_number,
            prescribedReps: set.prescribed_reps,
            prescribedIntensity: set.prescribed_intensity ?? null,
            prescribedPercent: set.prescribed_percent ?? null,
            suggestedLoadMin: set.suggested_load_min ?? null,
            suggestedLoadMax: set.suggested_load_max ?? null,
          })),
        ),
      );

      return { id: workout.id };
    });
  }

  /** Adds one exercise to an existing workout, creating the library entry when the
   * caller supplied a name instead of an id. Coach-only, transactional. */
  async addExercise(workoutId: string, dto: AddWorkoutExerciseDto, callerId: string) {
    await loadProgrammableWorkout(this.db, workoutId, callerId);

    if (Boolean(dto.exercise_id) === Boolean(dto.name)) {
      throw new BadRequestException('Supply exactly one of exercise_id or name');
    }

    if (dto.exercise_id) {
      const [exercise] = await this.db
        .select({ id: exercises.id })
        .from(exercises)
        .where(and(eq(exercises.id, dto.exercise_id), eq(exercises.createdBy, callerId)))
        .limit(1);

      if (!exercise) {
        throw new BadRequestException(`Unknown exercise: '${dto.exercise_id}'`);
      }
    }

    const seen = new Set<number>();
    for (const set of dto.sets) {
      if (seen.has(set.set_number)) {
        throw new BadRequestException(`Duplicate set_number ${set.set_number}`);
      }
      seen.add(set.set_number);
    }

    return this.db.transaction(async (tx) => {
      let exerciseId = dto.exercise_id;

      if (!exerciseId) {
        const [created] = await tx
          .insert(exercises)
          .values({ name: dto.name!, createdBy: callerId })
          .returning({ id: exercises.id });
        exerciseId = created.id;
      }

      // Append by default. The client used to send `order` from an array index,
      // which collided whenever an exercise had been removed.
      let order = dto.order;
      if (order === undefined) {
        const [last] = await tx
          .select({ order: workoutExercises.order })
          .from(workoutExercises)
          .where(eq(workoutExercises.workoutId, workoutId))
          .orderBy(desc(workoutExercises.order))
          .limit(1);
        order = (last?.order ?? -1) + 1;
      }

      const [workoutExercise] = await tx
        .insert(workoutExercises)
        .values({
          workoutId,
          exerciseId,
          displayName: dto.display_name ?? null,
          order,
          notes: dto.notes ?? null,
        })
        .returning({ id: workoutExercises.id });

      await tx.insert(sets).values(
        dto.sets.map((set) => ({
          workoutExerciseId: workoutExercise.id,
          setNumber: set.set_number,
          prescribedReps: set.prescribed_reps,
          prescribedIntensity: set.prescribed_intensity ?? null,
          prescribedPercent: set.prescribed_percent ?? null,
          suggestedLoadMin: set.suggested_load_min ?? null,
          suggestedLoadMax: set.suggested_load_max ?? null,
        })),
      );

      return { id: workoutExercise.id, exercise_id: exerciseId, order };
    });
  }

  /** Logs what was actually lifted on one set.
   *
   * The ownership walk is `sets → workout_exercises → workouts`, and only the
   * performer may write. An empty body is rejected rather than issuing an UPDATE
   * with no SET clause, which Drizzle turns into invalid SQL.
   */
  async updateSet(setId: string, dto: UpdateSetDto, callerId: string) {
    const owners = await loadSetOwners(this.db, setId);

    if (!owners) {
      throw new NotFoundException(`Set with ID ${setId} could not be found`);
    }

    // Read access first, so a stranger cannot distinguish "not yours" from
    // "does not exist".
    if (!(owners.athleteId === callerId || owners.coachId === callerId)) {
      throw new NotFoundException(`Set with ID ${setId} could not be found`);
    }

    if (!isPerformer(owners, callerId)) {
      throw new ForbiddenException('Only the athlete performing this workout can log a set');
    }

    const patch: Record<string, unknown> = {};
    if (dto.actual_load !== undefined) patch.actualLoad = dto.actual_load;
    if (dto.actual_intensity !== undefined) patch.actualIntensity = dto.actual_intensity;
    if (dto.is_completed !== undefined) patch.isCompleted = dto.is_completed;

    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Supply at least one of actual_load, actual_intensity or is_completed',
      );
    }

    const [updated] = await this.db.update(sets).set(patch).where(eq(sets.id, setId)).returning({
      id: sets.id,
      set_number: sets.setNumber,
      actual_load: sets.actualLoad,
      actual_intensity: sets.actualIntensity,
      is_completed: sets.isCompleted,
    });

    return updated;
  }

  /** Deletes a workout and everything under it. Coach-only.
   *
   * Explicit child deletes in dependency order: the foreign keys have no
   * `on delete cascade`, so deleting the workout first fails on the constraint.
   */
  async deleteWorkout(workoutId: string, callerId: string) {
    await loadProgrammableWorkout(this.db, workoutId, callerId);

    await this.db.transaction(async (tx) => {
      const children = await tx
        .select({ id: workoutExercises.id })
        .from(workoutExercises)
        .where(eq(workoutExercises.workoutId, workoutId));

      if (children.length) {
        const ids = children.map((c) => c.id);
        await tx.delete(sets).where(inArray(sets.workoutExerciseId, ids));
        await tx.delete(workoutExercises).where(inArray(workoutExercises.id, ids));
      }

      await tx.delete(workouts).where(eq(workouts.id, workoutId));
    });
  }

  /** Copies one workout onto several athletes at once.
   *
   * **The bottleneck this exists for.** A coach with ~17 athletes writing a week
   * by hand builds the same session seventeen times. That is the difference
   * between this app being usable and the coach going back to the spreadsheet.
   *
   * Deliberately copies an existing *workout* rather than applying a template. A
   * workout is a template exactly when `athlete_id` is null, and no UI path
   * produces that -- the program screen is only ever reached *for* an athlete and
   * always sends a concrete id -- so `GET /workouts/templates` is empty for
   * everyone and an assign built on templates would have nothing to assign. A
   * template source works here too, if one ever exists.
   *
   * Authorization is two separate questions:
   *
   *  - **the source** -- `loadReadableWorkout`, so the caller must already be able
   *    to see it. A co-coach copying a colleague's session onto their own athletes
   *    follows from the read rule settled in #35.
   *  - **each target** -- `isActiveCoachOf`, for *every* athlete, before anything
   *    is written. The 404 names the athlete rather than the workout, because the
   *    caller demonstrably may read the workout.
   *
   * The whole assignment is one transaction: seventeen copies either all land or
   * none do. A partial assignment is worse than a failed one -- the coach has no
   * way to see which athletes were missed.
   */
  async assignWorkout(workoutId: string, dto: AssignWorkoutDto, callerId: string) {
    // Authorize first; `loadReadableWorkout` returns ownership only, so the
    // copyable fields are read after the caller has been cleared for them.
    await loadReadableWorkout(this.db, workoutId, callerId);

    const [source] = await this.db
      .select({ name: workouts.name, notes: workouts.notes })
      .from(workouts)
      .where(eq(workouts.id, workoutId))
      .limit(1);

    // Duplicates in the body would otherwise create two copies for one athlete.
    const athleteIds = [...new Set(dto.athlete_ids)];

    // Every target is checked before any write. Checking inside the insert loop
    // would still roll back, but the coach would be told "athlete 12 is not on
    // your roster" only after eleven inserts had run.
    for (const athleteId of athleteIds) {
      if (!(await isActiveCoachOf(this.db, callerId, athleteId))) {
        throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
      }
    }

    const exerciseRows = await this.db
      .select({
        id: workoutExercises.id,
        exerciseId: workoutExercises.exerciseId,
        displayName: workoutExercises.displayName,
        order: workoutExercises.order,
        notes: workoutExercises.notes,
      })
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(asc(workoutExercises.order));

    const setRows = exerciseRows.length
      ? await this.db
          .select({
            workoutExerciseId: sets.workoutExerciseId,
            setNumber: sets.setNumber,
            prescribedReps: sets.prescribedReps,
            prescribedIntensity: sets.prescribedIntensity,
            prescribedPercent: sets.prescribedPercent,
            suggestedLoadMin: sets.suggestedLoadMin,
            suggestedLoadMax: sets.suggestedLoadMax,
          })
          .from(sets)
          .where(
            inArray(
              sets.workoutExerciseId,
              exerciseRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(sets.setNumber))
      : [];

    // ⚠️ Note what is NOT selected: actual_load, actual_intensity, is_completed.
    // Those are the source athlete's execution record. Copying them would hand
    // every target a pre-filled log of work they have not done, and a coach
    // reading adherence would see seventeen completed sessions.
    const setsBySourceExercise = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const bucket = setsBySourceExercise.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsBySourceExercise.set(set.workoutExerciseId, [set]);
    }

    return this.db.transaction(async (tx) => {
      const created: string[] = [];

      for (const athleteId of athleteIds) {
        const [workout] = await tx
          .insert(workouts)
          .values({
            name: source.name,
            date: dto.date,
            notes: source.notes,
            athleteId,
            // The assigning coach authors the copies, never the source's coach.
            // Otherwise a co-coach assigning a colleague's session would create
            // workouts they could not then edit -- loadProgrammableWorkout is
            // authoring-only.
            coachId: callerId,
            isTemplate: false,
          })
          .returning({ id: workouts.id });

        if (exerciseRows.length) {
          const insertedExercises = await tx
            .insert(workoutExercises)
            .values(
              exerciseRows.map((exercise) => ({
                workoutId: workout.id,
                exerciseId: exercise.exerciseId,
                displayName: exercise.displayName,
                order: exercise.order,
                notes: exercise.notes,
              })),
            )
            .returning({ id: workoutExercises.id, order: workoutExercises.order });

          // Paired on `order` rather than by index, for the same reason
          // createWorkout does: index pairing would silently mis-assign every set
          // if `returning` ever stopped preserving input order.
          const newIdByOrder = new Map(insertedExercises.map((row) => [row.order, row.id]));

          const newSets = exerciseRows.flatMap((exercise) =>
            (setsBySourceExercise.get(exercise.id) ?? []).map((set) => ({
              workoutExerciseId: newIdByOrder.get(exercise.order)!,
              setNumber: set.setNumber,
              prescribedReps: set.prescribedReps,
              prescribedIntensity: set.prescribedIntensity,
              prescribedPercent: set.prescribedPercent,
              suggestedLoadMin: set.suggestedLoadMin,
              suggestedLoadMax: set.suggestedLoadMax,
            })),
          );

          if (newSets.length) {
            await tx.insert(sets).values(newSets);
          }
        }

        created.push(workout.id);
      }

      return { assigned: created.length, workout_ids: created };
    });
  }
}

/** Rejects a payload whose set numbers or exercise orders collide.
 *
 * Duplicate `order` values would make `byOrder` above drop an exercise's sets
 * onto the wrong row, and duplicate `set_number`s within an exercise render as two
 * identically labelled rows the athlete cannot tell apart.
 */
function assertDistinctSetNumbers(exerciseList: CreateWorkoutDto['exercises']): void {
  const orders = new Set<number>();

  for (const exercise of exerciseList) {
    if (orders.has(exercise.order)) {
      throw new BadRequestException(`Duplicate exercise order ${exercise.order}`);
    }
    orders.add(exercise.order);

    const setNumbers = new Set<number>();
    for (const set of exercise.sets) {
      if (setNumbers.has(set.set_number)) {
        throw new BadRequestException(
          `Duplicate set_number ${set.set_number} in exercise order ${exercise.order}`,
        );
      }
      setNumbers.add(set.set_number);
    }
  }
}
