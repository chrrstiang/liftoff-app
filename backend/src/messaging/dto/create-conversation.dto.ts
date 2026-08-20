import { IsUUID } from 'class-validator';

/** Body for POST /conversations.
 *
 * This endpoint is the reason messaging currently does not work for a new user:
 * nothing in the app has ever created a `conversations` or `conversation_members`
 * row, so every thread had to be inserted by hand in the dashboard.
 *
 * Only the other participant is named. The caller is taken from the verified JWT
 * and added as a member server-side — membership is never client-supplied, which
 * is exactly how someone could otherwise insert themselves into a stranger's
 * thread and read it.
 */
export class CreateConversationDto {
  @IsUUID('4', { message: 'participant_id must be a valid UUID' })
  participant_id: string;
}
