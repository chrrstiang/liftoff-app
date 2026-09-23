import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { coaches, exerciseDefaultSetTemplates, exerciseTemplates, exercises } from 'src/db/schema';

/** The exercise library and its set templates.
 *
 * Both `exercises.created_by` and `exercise_templates.created_by` reference
 * `coaches`, not `users` — only a coach can author library content, and that is a
 * schema-level fact rather than a rule enforced here. Everything below is scoped to
 * the caller's own library.
 */
@Injectable()
export class ExercisesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The caller's exercise library. Needed by the workout builder, which has to
   * send an `exercise_id` that POST /workouts will accept. */
  async listExercises(callerId: string) {
    return this.db
      .select({
        id: exercises.id,
        name: exercises.name,
        created_at: exercises.createdAt,
      })
      .from(exercises)
      .where(eq(exercises.createdBy, callerId))
      .orderBy(asc(exercises.name));
  }

  /** Creates a library exercise owned by the calling coach.
   *
   * The coach check is not redundant with the schema. `exercises.created_by`
   * references `coaches`, so a non-coach insert *does* fail — but as a foreign-key
   * violation, which surfaces as a 500 and tells the caller nothing. Checking first
   * turns that into a 403 that names the actual problem.
   */
  async createExercise(name: string, callerId: string) {
    await this.assertCoach(callerId);

    /** ⚠️ Idempotent on name, rather than erroring.
     *
     * A coach typing "Back Squat" into the workout builder when they already have
     * one means "use that one" — they are not asking to create a second. Before
     * the unique index they *got* a second, and with maxes keyed on `exercise_id`
     * that quietly split their athlete's squat max in two.
     *
     * Returning the existing row is friendlier than a 400 and is what was meant.
     * The index is what makes it safe under a race: two concurrent creates cannot
     * both insert, and the loser falls into the same lookup below.
     *
     * Case-insensitive to match the index — "back squat" is not a new lift.
     */
    const [existing] = await this.db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(and(eq(exercises.createdBy, callerId), ilike(exercises.name, name)))
      .limit(1);

    if (existing) return existing;

    try {
      const [created] = await this.db
        .insert(exercises)
        .values({ name, createdBy: callerId })
        .returning({ id: exercises.id, name: exercises.name });

      return created;
    } catch (error) {
      // Lost a race against another create. The winner's row is what both
      // callers wanted, so return it rather than failing the second one.
      if (isUniqueViolation(error)) {
        const [winner] = await this.db
          .select({ id: exercises.id, name: exercises.name })
          .from(exercises)
          .where(and(eq(exercises.createdBy, callerId), ilike(exercises.name, name)))
          .limit(1);

        if (winner) return winner;
      }
      throw error;
    }
  }

  private async assertCoach(callerId: string): Promise<void> {
    const [isCoach] = await this.db
      .select({ id: coaches.id })
      .from(coaches)
      .where(eq(coaches.id, callerId))
      .limit(1);

    if (!isCoach) {
      throw new ForbiddenException('Only a coach can create an exercise');
    }
  }

  /** The caller's exercises that have at least one set template, nested.
   *
   * Only exercises **with** templates are returned, matching the old
   * `.not('templates', 'is', null)` filter — an exercise with no template has
   * nothing to prefill, so offering it in the template picker is a dead tap.
   *
   * Note the old client filtered exercises by `created_by = coachId` but never
   * filtered the nested templates, relying on the implicit foreign key. Both are
   * scoped explicitly here; a template authored by another coach against a shared
   * exercise would otherwise have leaked into this list.
   */
  async listExerciseTemplates(callerId: string) {
    const templateRows = await this.db
      .select({
        id: exerciseTemplates.id,
        name: exerciseTemplates.name,
        exercise_id: exerciseTemplates.exerciseId,
        exercise_name: exercises.name,
      })
      .from(exerciseTemplates)
      .innerJoin(exercises, eq(exercises.id, exerciseTemplates.exerciseId))
      .where(eq(exerciseTemplates.createdBy, callerId))
      .orderBy(asc(exercises.name));

    if (!templateRows.length) return [];

    const setRows = await this.db
      .select({
        id: exerciseDefaultSetTemplates.id,
        exercise_template_id: exerciseDefaultSetTemplates.exerciseTemplateId,
        set_number: exerciseDefaultSetTemplates.setNumber,
        prescribed_reps: exerciseDefaultSetTemplates.prescribedReps,
        prescribed_intensity: exerciseDefaultSetTemplates.prescribedIntensity,
      })
      .from(exerciseDefaultSetTemplates)
      .where(
        inArray(
          exerciseDefaultSetTemplates.exerciseTemplateId,
          templateRows.map((t) => t.id),
        ),
      )
      .orderBy(asc(exerciseDefaultSetTemplates.setNumber));

    const setsByTemplate = new Map<string, typeof setRows>();
    for (const set of setRows) {
      const bucket = setsByTemplate.get(set.exercise_template_id);
      if (bucket) bucket.push(set);
      else setsByTemplate.set(set.exercise_template_id, [set]);
    }

    // Grouped by exercise, which is the shape the picker renders: an exercise
    // heading with its named templates beneath.
    const byExercise = new Map<
      string,
      { id: string; name: string; templates: Array<Record<string, unknown>> }
    >();

    for (const template of templateRows) {
      let entry = byExercise.get(template.exercise_id);
      if (!entry) {
        entry = { id: template.exercise_id, name: template.exercise_name, templates: [] };
        byExercise.set(template.exercise_id, entry);
      }

      entry.templates.push({
        id: template.id,
        name: template.name,
        sets: setsByTemplate.get(template.id) ?? [],
      });
    }

    return [...byExercise.values()];
  }
}

/** Postgres `unique_violation`. Narrowed by code rather than message, since
 * messages are localised and change between versions. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
