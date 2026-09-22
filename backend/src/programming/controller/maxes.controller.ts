import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { MaxesService } from '../service/maxes.service';
import { MaxesQueryDto, RefreshMaxesDto, SetMaxOverrideDto } from '../dto/maxes.dto';

/** An athlete's maxes, which is what percentage prescription resolves against.
 *
 * Reads and writes deliberately use **different** rules, and the asymmetry matches
 * the one already established for workouts in docs/AUTHORIZATION.md:
 *
 *  - **read** — the athlete, or any active coach of them. A view-only head coach
 *    should see the numbers their athlete is programmed against.
 *  - **write** — an active coach only. Setting a max is programming: an athlete
 *    who could set their own would be rewriting every percentage they are given.
 *
 * The athlete is named in the request and authorized against the token. That is
 * not the banned "actor id from the body" pattern — it names *someone else*, and
 * the service decides whether the caller may reach them.
 */
@Controller('maxes')
export class MaxesController {
  constructor(private readonly maxesService: MaxesService) {}

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Query() query: MaxesQueryDto, @Req() req: RequestWithUser) {
    return this.maxesService.listMaxes(query.athlete_id, req.user.id);
  }

  /** Pins or clears a coach override. `override_value: null` clears it and lets the
   * derived value take over again.
   *
   * PATCH rather than PUT: every update in this codebase is a PATCH
   * (`/users/profile`, `/sets/:id`, `/coach-requests/:id`), and `lib/api/client.ts`
   * exposes no `put`. Adding a verb to the client for one endpoint would be the
   * tail wagging the dog, and this *is* a partial update — one column on a row the
   * caller does not otherwise own. */
  @Patch(':exerciseId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async setOverride(
    @Param('exerciseId', new ParseUUIDPipe()) exerciseId: string,
    @Body() dto: SetMaxOverrideDto,
    @Req() req: RequestWithUser,
  ) {
    return this.maxesService.setOverride(
      dto.athlete_id,
      exerciseId,
      dto.override_value,
      req.user.id,
    );
  }

  /** ⚠️ Declared **below** `PUT :exerciseId` but on a different verb, so they cannot
   * collide. If a `POST :exerciseId` is ever added, it must go below this — Nest
   * matches in declaration order and `:exerciseId` would swallow the literal
   * `refresh`. The same trap is documented on `workouts.controller.ts`. */
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async refresh(@Body() dto: RefreshMaxesDto, @Req() req: RequestWithUser) {
    return this.maxesService.refresh(dto.athlete_id, dto.exercise_id, req.user.id);
  }
}
