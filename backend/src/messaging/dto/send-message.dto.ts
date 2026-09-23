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

  /** A **storage path**, not a URL — `ChatBubble` hands it to
   * `supabase.storage.getPublicUrl`, so `@IsUrl` would reject the exact value the
   * client sends.
   *
   * ⚠️ Bounded because it was the one unbounded write on an otherwise carefully
   * validated DTO: `content` is capped at 4000, this took a string of any length
   * straight into a `text` column. 1024 is far past any real bucket key
   * (`conversations/<uuid>/<uuid>.jpg` is under 90) while still being a bound.
   *
   * `@MinLength(1)` because an empty string is not "no media" — it is a message
   * claiming to carry an image and resolving to a broken one. Omit the field
   * instead; that is what `@IsOptional` is for.
   */
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'media_url should not be empty' })
  @MaxLength(1024, { message: 'media_url must be shorter than or equal to 1024 characters' })
  media_url?: string;
}
