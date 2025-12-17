import { PartialType } from '@nestjs/mapped-types';
import { CreateAuthDto } from './create-auth-dto';
import { IsEmail,IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAuthDto extends PartialType(CreateAuthDto) {

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MinLength(6, {message: "password must be at least 6 characters long"})
    password?: string;
}
