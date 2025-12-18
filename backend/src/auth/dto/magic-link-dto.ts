import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class MagicLinkAuthDTO {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  redirect: string;
}
