import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { WorkoutsService } from '../service/workouts.service';
import { CreateWorkoutDto } from '../dto/create-workout.dto';
import { AssignWorkoutDto } from '../dto/assign-workout.dto';
import { ScheduledWorkoutsQueryDto } from '../dto/scheduled-workouts-query.dto';
import { AddWorkoutExerciseDto } from '../dto/add-workout-exercise.dto';
import { HistoryQueryDto } from '../dto/history-query.dto';

/** Workouts and their exercises.
 *
 * ⚠️ **Route order matters here.** `@Get('templates')` and `@Get('history')` must
 * stay above `@Get(':id')`: Nest matches in declaration order, so with them
 * swapped `/workouts/templates` binds `id = "templates"` and fails in
 * ParseUUIDPipe with a 400 about a malformed uuid — which reads like a client bug
 * rather than a routing one. Every literal route added here has the same
 * constraint.
 */
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  /** The calling coach's template library. */
  @Get('templates')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async templates(@Req() req: RequestWithUser) {
    return this.workoutsService.listTemplates(req.user.id);
  }

  /** An athlete's past workouts, newest first.
   *
   * ⚠️ A literal route, so it must stay above `@Get(':id')` — see the note on this
   * class.
   *
   * @param query `athlete_id`, plus the optional `before` / `limit` / `offset`
   *   page window.
   * @returns `{ workouts, limit, offset, has_more }`, each workout carrying its
   *   exercise and set totals.
   */
  @Get('history')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async history(@Query() query: HistoryQueryDto, @Req() req: RequestWithUser) {
    return this.workoutsService.listWorkoutHistory(query, req.user.id);
  }

  /** An athlete's **upcoming** assigned sessions.
   *
   * ⚠️ Bounded, where this used to return every workout ever assigned. Both
   * callers — the home card and the program screen — render what is coming up,
   * and both filtered client-side to get there. Over a season that is hundreds of
   * rows downloaded to draw a single card, on the screen users open most.
   *
   * The hand-rolled validation is gone with it. A DTO brings `forbidNonWhitelisted`
   * (a misspelt `?limt=` is now a 400 rather than a silently ignored default) and
   * bounds `limit` before it reaches SQL — the same reasoning `HistoryQueryDto`
   * records.
   */
  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Query() query: ScheduledWorkoutsQueryDto, @Req() req: RequestWithUser) {
    return this.workoutsService.listAthleteWorkouts(query, req.user.id);
  }

  @Get(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async find(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RequestWithUser) {
    return this.workoutsService.findWorkout(id, req.user.id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateWorkoutDto, @Req() req: RequestWithUser) {
    const { id } = await this.workoutsService.createWorkout(dto, req.user.id);
    return { id, message: 'Workout created successfully!' };
  }

  @Post(':id/exercises')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async addExercise(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddWorkoutExerciseDto,
    @Req() req: RequestWithUser,
  ) {
    return this.workoutsService.addExercise(id, dto, req.user.id);
  }

  /** Copies this workout onto several athletes at once.
   *
   * The 17-athletes-per-coach bottleneck: writing a week by hand means building
   * the same session seventeen times. `:id/assign` cannot collide with any
   * literal POST route, but a future `@Post('assign')` would have to be declared
   * above it — Nest matches in declaration order.
   */
  @Post(':id/assign')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignWorkoutDto,
    @Req() req: RequestWithUser,
  ) {
    return this.workoutsService.assignWorkout(id, dto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RequestWithUser) {
    await this.workoutsService.deleteWorkout(id, req.user.id);
    return { message: 'Workout deleted successfully!' };
  }
}
