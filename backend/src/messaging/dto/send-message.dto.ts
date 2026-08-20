import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for POST /conversations/:id/messages.
 *
 * `conversation_id` and the sender are both derived server-side — from the route
 * and the token respectively — so neither can be spoofed.
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'content should not be empty' })
  @MaxLength(4000, { message: 'content must be shorter than or equal to 4000 characters' })
  content: string;

  /** Matches the message_type enum: text | image | video | file. */
  @IsOptional()
  @IsIn(['text', 'image', 'video', 'file'], {
    message: 'message_type must be one of text, image, video, file',
  })
  message_type?: 'text' | 'image' | 'video' | 'file';

  @IsOptional()
  @IsString()
  media_url?: string;
}
