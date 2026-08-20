import { IsBoolean, IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

/** Body for PATCH /sets/:id — logging what was actually lifted.
 *
 * Only these three columns. The prescription (`prescribed_reps`,
 * `prescribed_intensity`, `suggested_load_*`) is the coach's, and letting it be
 * patched here would let an athlete rewrite the program they were given and then
 * report having completed it.
 *
 * All three are optional so a partial log works — clearing a mistyped load without
 * also un-completing the set. `null` is meaningful and distinct from omitted:
 * `{ actual_load: null }` clears the value, `{}` leaves it alone. `ValidateIf` is
 * what allows an explicit null through, since `IsNumber` would otherwise reject it.
 */
export class UpdateSetDto {
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  @Min(0)
  actual_load?: number | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  @Min(0)
  actual_intensity?: number | null;

  @IsOptional()
  @IsBoolean()
  is_completed?: boolean;
}
