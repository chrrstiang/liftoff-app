import { Controller, Body, Get, Post, Patch, HttpCode, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { UsersService } from '../service/users.service';
import { UpdateUserDto } from '../dto/update-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import type { RequestWithUser } from 'src/common/types/request.interface';

@Controller('users')
export class UserController {
  constructor(private readonly usersService: UsersService) {}

  /** The caller's own profile.
   *
   * The client read the `users` table directly for this — twice, once to render
   * the profile and once to decide whether it was complete. Both ran with the anon
   * key against a table whose SELECT policy is `using (true)`, so any signed-in
   * user could read any other user's row including their email.
   *
   * **A 404 here is a normal state, not an error.** Between signing up and
   * completing the form there is no `users` row at all — the Supabase trigger that
   * used to create one does not exist in RDS — and that is precisely the signal the
   * auth gate needs to route to create-profile.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async getOwnProfile(@Req() req: RequestWithUser) {
    return this.usersService.findOwnProfile(req.user);
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async createUserProfile(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    const user = req.user;
    await this.usersService.createUserProfile(dto, user);
    return { message: 'User profile created successfully!' };
  }

  /** Updates the athlete row with the same user_id value as the current
   * authenticated user. Updated fields are given to the DTO and updated accordingly in the
   * athlete row.
   *
   * @param updateUserDto The DTO containing the new values for the updated fields.
   * @returns An object containing a success message.
   */
  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async updateProfile(@Body() dto: UpdateUserDto, @Req() req: RequestWithUser) {
    const user = req.user;
    await this.usersService.updateProfile(dto, user);
    return { message: 'User profile updated successfully' };
  }
}
