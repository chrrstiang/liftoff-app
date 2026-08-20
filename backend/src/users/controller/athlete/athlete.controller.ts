import { Controller, Get, HttpCode, Query, Req, UseGuards, Param } from '@nestjs/common';
import { AthleteService } from '../../service/athlete/athlete.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';

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
