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

  @IsDateString()
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
