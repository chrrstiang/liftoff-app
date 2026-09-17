import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

/** The query string shared by both history routes.
 *
 * A DTO rather than hand-parsed `@Query('...')` strings. `GET /workouts` validates
 * its `athlete_id` by hand because `ParseUUIDPipe` cannot be applied to an optional
 * query parameter without also rejecting its absence — but a class sidesteps that
 * entirely, and it buys two things the hand-rolled version does not have:
 * `forbidNonWhitelisted` turns a misspelt `?limt=5` into a 400 instead of silently
 * serving the default page, and `limit` is bounded before it reaches SQL.
 */

export const DEFAULT_HISTORY_LIMIT = 20;

/** Caps how much one request can pull. History is read on a phone over a mobile
 * connection, and an unbounded `limit` is a free table scan for any caller. */
export const MAX_HISTORY_LIMIT = 50;

export class HistoryQueryDto {
  /** Whose history. Authorized against the token — the caller themselves, or an
   * athlete on the calling coach's roster. Never the actor id. */
  @IsUUID()
  athlete_id: string;

  /** Exclusive upper bound on `workouts.date`, as `YYYY-MM-DD`.
   *
   * The client sends **its own** local today. "Past" is a question about the
   * lifter's calendar, and the server's idea of today is UTC, so deriving it here
   * would file an evening session in the wrong day for anyone west of Greenwich.
   * Omitting it falls back to UTC today, which is the best guess available.
   *
   * Both decorators are load-bearing: `@Matches` pins the date-only shape so a
   * timestamp cannot arrive where a date is expected, and `@IsDateString` with
   * `strict` rejects a well-shaped impossible date like `2026-02-31`, which would
   * otherwise reach Postgres and come back as a 500.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'before must be a date of the form YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: 'before must be a real calendar date' })
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HISTORY_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** One page of history, with every default already applied. */
export interface HistoryWindow {
  before: string;
  limit: number;
  offset: number;
}

/** Applies the defaults. Called by the service rather than the controller so that
 * the cap and the `before` fallback hold for every caller, including a future one
 * that does not come in over HTTP. */
export function resolveHistoryWindow(query: HistoryQueryDto): HistoryWindow {
  return {
    before: query.before ?? new Date().toISOString().slice(0, 10),
    limit: Math.min(query.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT),
    offset: query.offset ?? 0,
  };
}
