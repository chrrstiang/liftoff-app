import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_ADHERENCE_DAYS = 28;

/** Caps the window. Adherence scans every set of every workout in the range for
 * the whole roster, so an unbounded `days` is a free full-table scan for any
 * caller. Twelve weeks covers a training block, which is the longest span a coach
 * would sensibly look at in one view. */
export const MAX_ADHERENCE_DAYS = 84;

/** Query for `GET /adherence` — who on my roster is actually doing the work.
 *
 * No `athlete_id`: this is deliberately roster-wide. The question a coach has is
 * "who is falling behind", which is not answerable one athlete at a time, and
 * scoping to the caller's own roster is what makes it safe without naming anyone.
 */
export class AdherenceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ADHERENCE_DAYS)
  days?: number;
}
