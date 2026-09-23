import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One prescribed set.
 *
 * The `actual_*` columns are absent on purpose: they are the athlete's execution
 * record and are written only by PATCH /sets/:id. Because ValidationPipe runs with
 * `forbidNonWhitelisted`, a coach who tries to pre-fill what their athlete lifted
 * gets a 400 rather than silently seeding the log.
 */
export class PrescribedSetDto {
  @IsInt()
  @Min(1)
  set_number: number;

  @IsInt()
  @Min(0)
  prescribed_reps: number;

  /** Text, not a number — it holds things like "RPE 8" or "75%". The asymmetry
   * with the numeric `actual_intensity` is carried over from the source schema. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  prescribed_intensity?: string;

  /** Percentage of the athlete's max for this exercise.
   *
   * The resolved kg is deliberately not accepted or stored — it is computed on
   * read against `athlete_maxes`, so refreshing a max re-scales every set
   * prescribed against it. See docs/MAXES-DESIGN.md.
   *
   * Bounded at 200 rather than 100: overload work above an athlete's competition
   * max is real programming (walkouts, partials, supramaximal holds). Above that
   * it is a decimal-point error, and rejecting it here beats an unliftable number
   * appearing on a screen three weeks later.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  prescribed_percent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  suggested_load_min?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  suggested_load_max?: number;
}

export class WorkoutExerciseDto {
  /** Must already exist in the library. Creating an exercise and adding it to a
   * workout in one call is POST /workouts/:id/exercises. */
  @IsUUID()
  exercise_id: string;

  /** What the athlete sees, when it differs from the library name ("Comp Squat"
   * for "Back Squat"). Falls back to the exercise's own name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  display_name?: string;

  @IsInt()
  @Min(0)
  order: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PrescribedSetDto)
  sets: PrescribedSetDto[];
}

/** Body for POST /workouts.
 *
 * `coach_id` is deliberately not a field. The old client sent it, and on Supabase
 * that meant any authenticated user could write a workout attributed to any coach.
 * It now comes from the verified token, and sending it is a 400.
 *
 * `is_template` is likewise absent: a workout is a template exactly when it has no
 * athlete. See the note in WorkoutsService.createWorkout.
 */
export class CreateWorkoutDto {
  @IsString()
  @MaxLength(100)
  name: string;

  /** The calendar day this session belongs to, as `YYYY-MM-DD`.
   *
   * ⚠️ **Date-only, and both decorators are load-bearing.** This used to be a
   * bare `@IsDateString()`, which accepts a full timestamp — and the client sent
   * one, via `toISOString()`. Postgres then truncated it to the **UTC** day, so a
   * coach in US Eastern writing at 9pm on the 5th had the workout stored on the
   * 6th. Their own screen showed the 5th (`toLocaleDateString`), so nothing
   * looked wrong at either end; the athlete simply saw it on the wrong day.
   *
   * `@Matches` pins the shape so a timestamp is rejected rather than silently
   * reinterpreted. `@IsDateString({ strict: true })` then rejects a well-formed
   * impossible date like `2026-02-31`, which would otherwise reach Postgres and
   * come back as a 500. `AssignWorkoutDto.date` and `HistoryQueryDto.before`
   * already do exactly this.
   *
   * Tightening this alone would have turned a silent wrong-day into a 400 — the
   * client had to stop sending a timestamp in the same change.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be of the form YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'date must be a real calendar date' })
  date: string;

  /** Null or omitted creates a template belonging to the calling coach. */
  @IsOptional()
  @IsUUID()
  athlete_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseDto)
  exercises: WorkoutExerciseDto[];
}
