import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import {
  IsString,
  IsNotEmpty,
  IsLowercase,
  Matches,
  Length,
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
}
