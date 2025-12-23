import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsLowercase,
  Matches,
  Length,
  IsBoolean,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';
import { IsUnique } from 'src/common/validation/decorators/unique.decorator';

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  GENDER_FLUID = 'Gender-fluid',
}

/** Contains all requierd fields when a user is completing their profile.
 *
 */
export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  first_name: string;

  @IsNotEmpty()
  @IsString()
  last_name: string;

  @IsNotEmpty()
  @IsString()
  @IsLowercase()
  @Matches(/^[a-z0-9._]+$/)
  @Length(3, 30)
  @IsUnique('users', 'username')
  username: string;

  @IsNotEmpty()
  @IsEnum(Gender)
  gender: Gender;

  @IsNotEmpty()
  @IsDateString()
  date_of_birth: string;

  @IsNotEmpty()
  @IsBoolean()
  is_athlete: boolean;

  @IsNotEmpty()
  @IsBoolean()
  is_coach: boolean;

  @IsOptional()
  @IsString()
  federation_id?: string;

  @IsOptional()
  @IsString()
  division_id?: string;

  @IsOptional()
  @IsString()
  weight_class_id?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  biography?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  years_of_experience?: number;
}
