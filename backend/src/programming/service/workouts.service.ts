import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { athletes, coaches, exercises, sets, workoutExercises, workouts } from 'src/db/schema';
import type { CreateWorkoutDto } from '../dto/create-workout.dto';
import type { AddWorkoutExerciseDto } from '../dto/add-workout-exercise.dto';
import type { UpdateSetDto } from '../dto/update-set.dto';
import {
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
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
        sets: setsByExercise.get(row.id) ?? [],
      })),
    };
  }

  /** An athlete's assigned workouts, newest last.
   *
   * Readable by the athlete themselves and by any coach with an active
   * relationship. Templates are excluded — they belong to a coach's library, not
   * to anyone's calendar, and `athlete_id` is null on them anyway.
   */
  async listAthleteWorkouts(athleteId: string, callerId: string) {
    if (athleteId !== callerId && !(await isActiveCoachOf(this.db, callerId, athleteId))) {
      // 404, not 403: a 403 here confirms which user ids are athletes.
      throw new NotFoundException(`Athlete with ID ${athleteId} could not be found`);
    }

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
