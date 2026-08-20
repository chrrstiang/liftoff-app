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
  @IsNotEmpty()
  @IsString()
  name?: string;

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
