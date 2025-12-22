import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  HttpCode,
  Query,
  UseGuards,
  Req,
  Param,
} from '@nestjs/common';
import { AthleteService } from '../../service/athlete/athlete.service';
import { CreateAthleteDto } from '../../dto/athlete/create-athlete.dto';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';
import type { RequestWithUser } from 'src/common/types/request.interface';

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
