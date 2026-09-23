import { IsBoolean, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { MAX_PLAUSIBLE_LOAD_KG } from '../service/e1rm';

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
  /** ⚠️ Bounded above as well as below, and the ceiling matters more than it
   * looks.
   *
   * This was `Min(0)` with no maximum, so an athlete meaning 100kg who typed
   * 1000 logged it happily. #36 stopped that propagating into a derived max, but
   * only there — the set still stored 1000kg and history still displayed it as
   * though it happened. Bounding here is the root fix; #36 contained the blast
   * radius.
   *
   * The ceiling is shared with the coach's manual override, so the two ways a
   * number can end up describing a lift cannot disagree about what is plausible.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_LOAD_KG)
  actual_load?: number | null;

  /** RPE, on the 1-10 scale.
   *
   * Previously `Min(0)` with no ceiling, which disagreed with the domain:
   * `estimateOneRepMax` already refuses anything outside 1-10, treating it as a
   * data-entry error rather than a very easy set. So a logged RPE of 0 or 47 was
   * accepted, stored, and rendered in history as "@0" — while contributing
   * nothing, for reasons invisible from the screen.
   *
   * Matching the DTO to the domain means the rejection happens where the user can
   * still fix it.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  @Min(1)
  @Max(10)
  actual_intensity?: number | null;

  @IsOptional()
  @IsBoolean()
  is_completed?: boolean;
}
