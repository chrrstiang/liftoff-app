import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { SendMessageDto } from './send-message.dto';

/** Sending a message, validated through a real ValidationPipe configured exactly
 * as `main.ts` registers it globally.
 *
 * ⚠️ `media_url` was the one unbounded write on an otherwise carefully validated
 * DTO — `content` capped at 4000, this a bare `@IsString()` into a `text` column.
 */
describe('SendMessageDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const metadata: ArgumentMetadata = { type: 'body', metatype: SendMessageDto, data: '' };
  const parse = (body: Record<string, unknown>) => pipe.transform(body, metadata);

  it('accepts a plain text message', async () => {
    await expect(parse({ content: 'nice session' })).resolves.toMatchObject({
      content: 'nice session',
    });
  });

  /** A real bucket key — `conversations/<uuid>/<uuid>.jpg` — is under 90
   * characters, so the bound has to clear that comfortably. */
  it('accepts a realistic storage path', async () => {
    const path = `conversations/${'a'.repeat(36)}/${'b'.repeat(36)}.jpg`;

    await expect(
      parse({ content: 'photo', message_type: 'image', media_url: path }),
    ).resolves.toMatchObject({ media_url: path });
  });

  it('accepts a path exactly at the ceiling', async () => {
    await expect(parse({ content: 'x', media_url: 'a'.repeat(1024) })).resolves.toBeDefined();
  });

  it('rejects a path past the ceiling', async () => {
    await expect(parse({ content: 'x', media_url: 'a'.repeat(1025) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /** An empty string is not "no media" — it is a message claiming to carry an
   * image and resolving to a broken one. Omitting the field is how you say no. */
  it('rejects an empty media_url rather than storing a broken reference', async () => {
    await expect(parse({ content: 'x', media_url: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /** Absent means undefined, not a materialised empty value — `class-transformer`
   * does create the key, which is why this asserts the value rather than the
   * property's absence. */
  it('accepts the field being absent', async () => {
    await expect(parse({ content: 'x' })).resolves.toMatchObject({ media_url: undefined });
  });

  /** `media_url` is a storage path, not a URL: `ChatBubble` hands it to
   * `supabase.storage.getPublicUrl`. An `@IsUrl` rule would reject the exact
   * value the client sends, so this pins that it does not. */
  it('does not require the value to be a URL', async () => {
    await expect(
      parse({ content: 'x', media_url: 'conversations/abc/def.jpg' }),
    ).resolves.toBeDefined();
  });

  it('still rejects an unknown field', async () => {
    await expect(parse({ content: 'x', sender_id: 'someone-else' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
