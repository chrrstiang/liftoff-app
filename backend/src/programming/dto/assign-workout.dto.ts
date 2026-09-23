import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsUUID,
  Matches,
} from 'class-validator';

/** Caps one assignment. The target is a university team of ~50 lifters, so this
 * is not a real limit for anyone — it is a bound on how much work a single
 * request can commit in one transaction. */
export const MAX_ASSIGN_ATHLETES = 100;

/** Body for `POST /workouts/:id/assign` — copying one workout to several athletes.
 *
 * **Deliberately not "apply a template".** A workout is a template exactly when
 * `athlete_id` is null, and no UI path produces that: the program screen is only
 * ever reached *for* an athlete and always sends a concrete id. So
 * `GET /workouts/templates` is empty for everyone, and an assign built on
 * templates would have nothing to assign. Copying an existing workout works
 * today, matches how a coach actually writes a week, and accepts a template
 * source too if one ever exists.
 */
export class AssignWorkoutDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Name at least one athlete to assign to' })
  @ArrayMaxSize(MAX_ASSIGN_ATHLETES)
  @IsUUID('4', { each: true, message: 'each athlete_id must be a valid UUID' })
  athlete_ids: string[];

  /** The date the copies land on, as `YYYY-MM-DD`.
   *
   * ⚠️ **Date-only, and both decorators are load-bearing.** `@Matches` pins the
   * shape so a timestamp cannot arrive where a calendar date is expected, and
   * `@IsDateString({ strict: true })` rejects a well-formed impossible date like
   * `2026-02-31` that would otherwise reach Postgres as a 500.
   *
   * This route was written this way because `POST /workouts` was not: it took a
   * full `@IsDateString()` and was fed `Date.toISOString()`, so a workout written
   * at 9pm Eastern was stored on the following UTC day. That has since been fixed
   * and both routes now agree — "which day does this session belong to" is a
   * question about the lifter's calendar, not about UTC.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be of the form YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'date must be a real calendar date' })
  date: string;
}
