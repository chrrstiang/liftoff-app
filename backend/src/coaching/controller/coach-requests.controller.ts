import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { CoachRequestsService } from '../service/coach-requests.service';
import { CreateCoachRequestDto } from '../dto/create-coach-request.dto';
import { RespondCoachRequestDto } from '../dto/respond-coach-request.dto';

/** Coach ↔ athlete invitations.
 *
 * Guards are applied per route, matching the rest of this codebase — that is the
 * mechanism by which /health stays public, so do not promote this to a
 * class-level guard.
 *
 * Every handler passes `req.user.id` to the service and nothing else identifying.
 * The caller's identity always comes from the verified token, never the body.
 */
@Controller('coach-requests')
export class CoachRequestsController {
  constructor(private readonly coachRequestsService: CoachRequestsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateCoachRequestDto, @Req() req: RequestWithUser) {
    await this.coachRequestsService.createRequest(dto.athlete_id, req.user.id);
    return { message: 'Invitation sent successfully!' };
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async respond(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RespondCoachRequestDto,
    @Req() req: RequestWithUser,
  ) {
    await this.coachRequestsService.respondToRequest(id, dto.status, req.user.id);
    return { message: `Invitation ${dto.status} successfully!` };
  }

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: RequestWithUser) {
    return this.coachRequestsService.listRequestsForAthlete(req.user.id);
  }

  @Get('roster')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async roster(@Req() req: RequestWithUser) {
    return this.coachRequestsService.listRoster(req.user.id);
  }
}
