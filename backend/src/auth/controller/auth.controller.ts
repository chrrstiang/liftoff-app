import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode } from '@nestjs/common';
import { AuthService } from '../service/auth.service';
import { CreateAuthDto } from '../dto/create-auth-dto';
import { UpdateAuthDto } from '../dto/update-auth-dto';
import { SupabaseService } from 'src/supabase/supabase.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService
  ) {}

  /** Signs up an user of the application using their email and password.
   * 
   * @param createAuthDto The DTO containing the email and password of the user.
   */
  @Post('signup')
  @HttpCode(201)
  async signUp(@Body() dto: CreateAuthDto) {
    await this.authService.createUser(dto, this.supabaseService.getClient());
    return { message: 'User created successfully' };
  }

  /** Logs an existing user into the application with their email and password.
   * 
   * @param verifyAuthDto The DTO containg the email and password used to log in.
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: CreateAuthDto) {
    const session = await this.authService.login(dto, this.supabaseService.getClient());
    return { 
      message: 'Login successful',
      access_token: session.access_token,
      user: session.user
     };
  }

  /** Logs a user out of their account on the current device/session.
   * 
   */
  @Post('logout')
  @HttpCode(200)
  async logout() {
    await this.authService.logout(this.supabaseService.getClient());
    return { message: 'Logout successful' };
  }

  /** Finds the authenticated user with the given ID, and updates their email/password.
   * 
   * @param updateAuthDto The DTO containing the new field value to update (email or password).
   */
  @Patch('update')
  @HttpCode(200)
  async update(@Body() dto: UpdateAuthDto) {
    await this.authService.update(dto, this.supabaseService.getClient());
    return { message: 'User updated successfully' };
  }
}
