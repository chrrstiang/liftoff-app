import { IsIn } from 'class-validator';

/** Body for PATCH /coach-requests/:id.
 *
 * `pending` is not accepted: this endpoint exists to resolve a request, and
 * allowing a move back to pending would let an athlete un-decline indefinitely.
 */
export class RespondCoachRequestDto {
  @IsIn(['accepted', 'rejected'], {
    message: 'status must be either accepted or rejected',
  })
  status: 'accepted' | 'rejected';
}
