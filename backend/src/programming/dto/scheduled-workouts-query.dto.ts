import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

/** Caps one page. A season of training is hundreds of sessions; the callers of
 * this route render "what is coming up", and nobody's upcoming schedule is 100
 * sessions long. */
export const MAX_SCHEDULED_WORKOUTS = 100;

/** Query for `GET /workouts` — an athlete's **upcoming** sessions.
 *
 * ⚠️ **This route used to return every workout the athlete had ever been
 * assigned**, unbounded and forever, and both callers then filtered client-side
 * to find what was next. Over a season that is hundreds of rows downloaded to
 * render a single card, on the screen users open most, on a phone in a gym.
 */
export class ScheduledWorkoutsQueryDto {
  @IsUUID()
  athlete_id: string;

  /** Inclusive lower bound on `workouts.date`, as `YYYY-MM-DD`.
   *
   * ⚠️ **The client sends its own local today**, for the same reason
   * `HistoryQueryDto.before` does: "upcoming" is a question about the lifter's
   * calendar, and the server's idea of today is UTC. Deriving it here would hide
   * tonight's session from anyone west of Greenwich after 8pm — which is exactly
   * the bug that was just fixed on the write side.
   *
   * Omitting it falls back to UTC today, which is the best guess available
   * without the client telling us.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a date of the form YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'from must be a real calendar date' })
  from?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SCHEDULED_WORKOUTS)
  limit?: number;
}
