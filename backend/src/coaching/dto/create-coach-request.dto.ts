import { IsUUID } from 'class-validator';

/** Body for POST /coach-requests.
 *
 * Deliberately carries only the athlete. The coach is taken from the verified
 * JWT — accepting a `coach_id` from the client is exactly how a caller could
 * previously fabricate an invite on someone else's behalf.
 */
export class CreateCoachRequestDto {
  @IsUUID('4', { message: 'athlete_id must be a valid UUID' })
  athlete_id: string;
}
