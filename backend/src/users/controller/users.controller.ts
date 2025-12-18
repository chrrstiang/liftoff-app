import {
  Controller,
  Body,
  Patch,
  HttpCode,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { UsersService } from '../service/users.service';
import { UpdateUserDto } from '../dto/update-user.dto';

@Controller('user')
export class UserController {
  constructor(private readonly usersService: UsersService) {}

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
  async updateProfile(@Body() dto: UpdateUserDto, @Req() req) {
    const user = req.user;
    await this.usersService.updateProfile(dto, user);
    return { message: 'User profile updated successfully' };
  }
}
