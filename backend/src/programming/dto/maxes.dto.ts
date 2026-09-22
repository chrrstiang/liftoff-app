import { IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { MAX_PLAUSIBLE_LOAD_KG } from '../service/e1rm';

/** Which athlete's maxes. Follows the same shape as `HistoryQueryDto`: the athlete
 * is named in the request and authorized against the token, never taken *as* the
 * caller. */
export class MaxesQueryDto {
  @IsUUID()
  athlete_id: string;
}

/** Re-exported from the domain module so the two ways a number can become a max —
 * a coach pinning an override, and derivation from a logged set — are bounded by
 * the same constant and cannot drift apart. */
export { MAX_PLAUSIBLE_LOAD_KG } from '../service/e1rm';

/** Body for `PUT /maxes/:exerciseId` — pinning or clearing a coach override.
 *
 * `override_value: null` is meaningful and distinct from omitting it: null clears
 * the pin and lets the derived value take over again. `ValidateIf` is what allows
 * an explicit null through, since `IsNumber` would otherwise reject it — the same
 * pattern `UpdateSetDto` uses for clearing a mistyped load.
 */
export class SetMaxOverrideDto {
  @IsUUID()
  athlete_id: string;

  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(MAX_PLAUSIBLE_LOAD_KG)
  override_value: number | null;
}

/** Body for `POST /maxes/refresh`.
 *
 * `exercise_id` is optional: omitting it refreshes every exercise the athlete has
 * logged work on, which is what a coach starting a new block wants. Naming one
 * refreshes just that, which is what a coach who disagrees with a single number
 * wants.
 */
export class RefreshMaxesDto {
  @IsUUID()
  athlete_id: string;

  @IsOptional()
  @IsUUID()
  exercise_id?: string;
}
