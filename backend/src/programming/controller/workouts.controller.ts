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
import { AddWorkoutExerciseDto } from '../dto/add-workout-exercise.dto';

/** Workouts and their exercises.
 *
 * ⚠️ **Route order matters here.** `@Get('templates')` must stay above
 * `@Get(':id')`: Nest matches in declaration order, so with them swapped
 * `/workouts/templates` binds `id = "templates"` and fails in ParseUUIDPipe with a
 * 400 about a malformed uuid — which reads like a client bug rather than a routing
 * one.
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

  /** An athlete's assigned workouts. `athlete_id` is required and authorized
   * against the caller — omitting it does not fall back to "everything". */
  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: RequestWithUser, @Query('athlete_id') athleteId?: string) {
    if (!athleteId) {
      throw new BadRequestException('athlete_id is required');
    }

    // Validated by hand rather than with ParseUUIDPipe, which does not apply to
    // an optional query parameter without also rejecting its absence.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(athleteId)) {
      throw new BadRequestException('athlete_id must be a UUID');
    }

    return this.workoutsService.listAthleteWorkouts(athleteId, req.user.id);
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

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RequestWithUser) {
    await this.workoutsService.deleteWorkout(id, req.user.id);
    return { message: 'Workout deleted successfully!' };
  }
}
