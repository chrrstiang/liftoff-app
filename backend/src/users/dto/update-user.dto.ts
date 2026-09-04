import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import {
  IsString,
  IsNotEmpty,
  IsLowercase,
  IsOptional,
  Matches,
  Length,
  MaxLength,
} from 'class-validator';
import { IsUnique } from 'src/common/validation/decorators/unique.decorator';

/** This DTO contains the columns that may be updated in the
 * users table of a user.
 *
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {
  /** ⚠️ There used to be a `name?: string` here, and it made this endpoint
   * unusable.
   *
   * `PartialType` only relaxes fields it inherits from `CreateUserDto`, and `name`
   * was not one of them — so its `@IsNotEmpty()` ran on every request and **any
   * PATCH omitting `name` was a 400.** It mapped to nothing either: there is no
   * `name` column (the schema has `first_name` / `last_name`) and `updateProfile`
   * never read it. The visible effect was that avatar upload silently failed —
   * `lib/api/storage.ts` sends `{ avatar_url }` alone — after the image had already
   * been written to the bucket.
   *
   * Note `username` below is safe from the same trap only because it *is* on
   * `CreateUserDto`, so `PartialType`'s `@IsOptional()` covers it and
   * short-circuits the rest. **Any new field declared here rather than inherited
   * needs an explicit `@IsOptional()`.** See `avatar_url`.
   */
  @IsNotEmpty()
  @IsString()
  @IsLowercase()
  @Matches(/^[a-z0-9._]+$/i)
  @Length(3, 30)
  @IsUnique('users', 'username')
  username?: string;

  /** The avatar's **storage path**, not a URL.
   *
   * Images still live in Supabase Storage — only Postgres moved — so what lands
   * here is a path like `avatars/<id>/<ts>.jpg` that the client resolves against
   * the bucket. It is on the update DTO rather than the create one because
   * profile creation has no image to point at yet.
   *
   * Not optional-by-inheritance: `PartialType(CreateUserDto)` only relaxes fields
   * that exist on CreateUserDto, and this is not one of them.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar_url?: string;
}
