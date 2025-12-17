import {
  BadRequestException,
  InternalServerErrorException
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { CreateAuthDto } from '../dto/create-auth-dto';
import { UpdateAuthDto } from '../dto/update-auth-dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuthService {

  /** Given a DTO with an inputted email and password, a user is logged into their account.
   * 
   * @param createAuthDto The DTO containing the email and password to use to log in.
   * @param supabase The Supabase client.
   * 
   * @throws if the email doesn't exist or if the password is incorrect.
   */
  async login(body: CreateAuthDto, supabase: SupabaseClient) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password
    })

    if (error) {
      throw new BadRequestException('Failed to login user: ' + error.message);
    }

    return data.session;
  }

  /** Logs a user out of the application.
   * 
   * @param supabase The Supabase client.
   */
  async logout(supabase: SupabaseClient) {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw new InternalServerErrorException('Failed to log out.');
      }
  }

  /** Creates a new user of the application. The user is created in the Auth table, 
   * and manually stored in the 'users' table with their email and password.
   * 
   * @param createAuthDto The DTO containing the email and password of the new user.
   * @param supabase The Supabase client.
   * 
   */
  async createUser(dto: CreateAuthDto, supabase: SupabaseClient) {

    const email = dto.email;
    const password = dto.password;

    const {data, error} =  await supabase.auth.signUp({
      email: email,
      password: password
    })

    if (error) {
      throw new BadRequestException('Could not sign up user.');
    } else if (!data?.user?.id) {
      throw new InternalServerErrorException("ID could not be located upon sign up.");
    }

    return data.user.id;
  }

  /** Method is called when a user attempts to update either the email or password of their 
   * account. Given the new info in an object, their email is updated in Supabase's 
   * 'users' table, and email/password is updated in the Auth section.
   * 
   * @param updateAuthDto The DTO containing the new email to use.
   * @param supabase The Supabase Client
   */
  async update(dto: UpdateAuthDto, supabase: SupabaseClient) {

    const updatedData : { email? : string, password? : string } = {};

    if (dto.email) {
      updatedData.email = dto.email;
    }

    if (dto.password) {
      updatedData.password = dto.password;
    }

      const { data, error } = await supabase.auth.updateUser(updatedData);
  
      if (error) {
        throw new BadRequestException('Could not update user: ' + error.message);
      } else if (!data?.user?.id) {
        throw new BadRequestException(
          'Failed to identify user: Check input',
        );
      }
    }
}
