import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
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

    const [created] = await this.db
      .insert(exercises)
      .values({ name, createdBy: callerId })
      .returning({ id: exercises.id, name: exercises.name });

    return created;
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
