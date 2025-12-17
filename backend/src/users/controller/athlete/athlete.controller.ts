import { Controller, Get, Post, Body, Patch, HttpCode, Query, UseGuards, Req, Param } from '@nestjs/common';
import { AthleteService } from '../../service/athlete/athlete.service';
import { CreateAthleteDto } from '../../dto/athlete/create-athlete.dto';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';

@Controller('athlete')
export class AthleteController {
  constructor(
    private readonly athleteService: AthleteService) {}

  /** Creates an athlete row in the Supabase 'athletes' table for the current
     * authenticated user. The profile is created using the provided fields in the DTO, where a 
     * name and username are required, and the 'athlete' role is already assumed. 
     * 
     * @param createAthleteDto The DTO containing the athlete profile information.
     * @returns An object containing a success message.
     */
  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async createProfile(@Body() createAthleteDto: CreateAthleteDto, @Req() req: any) {
    const user = req.user
    await this.athleteService.createProfile(createAthleteDto, user);
    return { message: 'Profile created successfully' }
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

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async updateAthleteProfile(@Body() dto: UpdateAthleteDto, @Req() req) {
    const user = req.user;
    await this.athleteService.updateAthleteProfile(user, dto)
    return { message: 'Athlete profile updated successfully' };
  }
}