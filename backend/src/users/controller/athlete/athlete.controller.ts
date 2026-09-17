import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AthleteService } from '../../service/athlete/athlete.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { UpdateAthleteDto } from '../../dto/athlete/update-athlete.dto';

@Controller('athlete')
export class AthleteController {
  constructor(private readonly athleteService: AthleteService) {}

  /** Athlete search for the invite flow.
   *
   * ⚠️ Declared **above** `profile/:id`. Nest matches routes in declaration order,
   * and while `search` and `profile/:id` cannot collide today, adding a bare
   * `:id` route above this line would swallow it.
   *
   * Results exclude the caller and anyone they have already invited or signed.
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async search(@Req() req: RequestWithUser, @Query('q') q?: string) {
    return this.athleteService.searchAthletes(q ?? '', req.user.id);
  }

  /** Updates the caller's own competing details: federation, division, weight class.
   *
   * ⚠️ **No id, anywhere.** Not in the path, not in `UpdateAthleteDto`. A user may
   * only ever update their own row, and the caller comes from the verified token —
   * accepting an id would mean the endpoint had to decide whether to honour it,
   * which is a decision no correct answer makes necessary.
   *
   * Declared **above** `profile/:id` and below `search`, but the ordering is not
   * load-bearing here: `PATCH profile` and `GET profile/:id` differ in both method
   * and shape. It sits next to the route it mirrors so the pair reads together.
   *
   * @param dto The columns to change. `null` clears one, absent leaves it alone.
   * @returns An object containing a success message.
   */
  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async updateOwnProfile(@Body() dto: UpdateAthleteDto, @Req() req: RequestWithUser) {
    await this.athleteService.updateOwnProfile(dto, req.user);
    return { message: 'Athlete profile updated successfully' };
  }

  /** Retrieves the public profile of the current athlete user. A public athlete profile can
   * contain their name, username, weight class, division and team.
   *
   * @returns An object containing the fields of the public athlete profile.
   */
  @Get('profile/:id')
  @UseGuards(JwtAuthGuard, AthleteExistsGuard)
  @HttpCode(200)
  async retrieveProfileDetails(@Param('id') id: string, @Query('data') data?: string) {
    const columnsArray = data ? data.split(',') : undefined;
    return this.athleteService.retrieveProfileDetails(id, columnsArray);
  }
}
