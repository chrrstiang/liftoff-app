import { Controller, Get, HttpCode, Query, UseGuards, Param } from '@nestjs/common';
import { AthleteService } from '../../service/athlete/athlete.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';

@Controller('athlete')
export class AthleteController {
  constructor(private readonly athleteService: AthleteService) {}

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
