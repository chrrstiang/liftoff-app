import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { ExercisesService } from '../service/exercises.service';

/** Body for POST /exercises. One field, so it lives here rather than in dto/. */
export class CreateExerciseDto {
  @IsString()
  @MinLength(1, { message: 'name should not be empty' })
  @MaxLength(100)
  name: string;
}

/** The exercise library.
 *
 * `templates` is declared before any parameterised route for the same reason as on
 * the workouts controller — there is no `:id` route here today, but adding one
 * below this line keeps that safe.
 */
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get('templates')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async templates(@Req() req: RequestWithUser) {
    return this.exercisesService.listExerciseTemplates(req.user.id);
  }

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: RequestWithUser) {
    return this.exercisesService.listExercises(req.user.id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateExerciseDto, @Req() req: RequestWithUser) {
    return this.exercisesService.createExercise(dto.name, req.user.id);
  }
}
