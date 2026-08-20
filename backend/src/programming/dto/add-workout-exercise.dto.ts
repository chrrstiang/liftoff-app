import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PrescribedSetDto } from './create-workout.dto';

/** Body for POST /workouts/:id/exercises.
 *
 * Supply **either** `exercise_id` for something already in the library **or**
 * `name` to create a library exercise and add it in one call. The frontend's
 * `createExercise` did exactly the latter as three unguarded client-side inserts;
 * this is that flow with the ownership check and a transaction.
 *
 * Passing both, or neither, is a 400 raised in the service — expressing
 * "exactly one of these" in class-validator takes a custom constraint whose failure
 * message is worse than the explicit check.
 */
export class AddWorkoutExerciseDto {
  @IsOptional()
  @IsUUID()
  exercise_id?: string;

  /** Creates a new library exercise owned by the calling coach. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  display_name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

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
