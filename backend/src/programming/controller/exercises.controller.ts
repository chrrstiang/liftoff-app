import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { ExercisesService } from '../service/exercises.service';
import { WorkoutsService } from '../service/workouts.service';
import { HistoryQueryDto } from '../dto/history-query.dto';

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
 * the workouts controller — there is no bare `:id` route here today, but adding one
 * below this line keeps that safe. `:exerciseId/history` is two segments deep, so
 * it cannot swallow either of the single-segment routes.
 */
@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly workoutsService: WorkoutsService,
  ) {}

  @Get('templates')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async templates(@Req() req: RequestWithUser) {
    return this.exercisesService.listExerciseTemplates(req.user.id);
  }

  /** Every set an athlete has logged for one exercise, newest session first.
   *
   * Delegates to WorkoutsService for the same reason SetsController does: the path
   * names an exercise, but the data is `workouts -> workout_exercises -> sets` and
   * so is the authorization — what is owned by somebody here is the athlete's log,
   * not the exercise.
   *
   * @param exerciseId the library exercise. An id the athlete has never trained
   *   returns an empty list rather than a 404.
   * @param query `athlete_id`, plus the optional `before` / `limit` / `offset`
   *   page window. Pagination is over sessions.
   * @returns `{ sessions, limit, offset, has_more }`.
   */
  @Get(':exerciseId/history')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async history(
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Query() query: HistoryQueryDto,
    @Req() req: RequestWithUser,
  ) {
    return this.workoutsService.listExerciseHistory(exerciseId, query, req.user.id);
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
