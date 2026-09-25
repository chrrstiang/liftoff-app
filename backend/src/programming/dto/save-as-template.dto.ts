import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Body for POST /workouts/:id/save-as-template.
 *
 * Both fields are optional: omitting them keeps the source workout's own name
 * and notes, which is what a coach saving "Week 3 Upper" almost always wants.
 *
 * ⚠️ **There is deliberately no `athlete_id` here, and no `is_template`.** A
 * workout is a template exactly when `athlete_id` is null, and that is decided by
 * *which endpoint you called*, never by the body. `forbidNonWhitelisted` makes
 * sending either a 400.
 */
export class SaveAsTemplateDto {
  /** Trimmed before validation, so `"   "` is a 400 rather than a silent
   * fallback to the source's name. `@MinLength` runs on the stored value, so
   * without the transform a whitespace-only name passes the check and then
   * quietly disappears in the service — the coach asked for a rename and got the
   * old name back with no explanation. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'name should not be empty' })
  @MaxLength(100)
  name?: string;

  /** Explicit `null` clears the copied notes; omitting the field keeps them.
   *
   * `@ValidateIf` is what makes those two different — without it `@IsString()`
   * would reject the null, and there would be no way to save a template without
   * inheriting a note that referred to one athlete's week.
   */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
