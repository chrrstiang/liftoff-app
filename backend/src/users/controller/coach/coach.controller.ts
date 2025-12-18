import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { CreateCoachDto } from '../../dto/coach/create-coach.dto';
import { CoachService } from '../../service/coach/coach.service';

@Controller('coach')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Post()
  create(@Body() createCoachDto: CreateCoachDto) {
    return this.coachService.create(createCoachDto);
  }

  @Get('athletes')
  findAllAthletes() {
    return this.coachService.findAll();
  }

  @Get('athletes/:id')
  findAthlete(@Param('id') id: string) {
    return this.coachService.findOne(+id);
  }

  @Get('athletes/:id/program')
  getAthletePrograms(@Param() id: string) {
    return this.coachService.findOne(+id);
  }

  @Patch('/athletes/:id/')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.coachService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coachService.remove(+id);
  }
}
