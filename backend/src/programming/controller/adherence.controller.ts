import { Controller, Get, HttpCode, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { AdherenceService } from '../service/adherence.service';
import { AdherenceQueryDto } from '../dto/adherence-query.dto';

/** Who on the calling coach's roster is actually doing the work.
 *
 * **No id in the request.** The roster comes from the verified token, so there is
 * nothing for a caller to tamper with — the query starts from the caller's own
 * `coach_athlete_relationships` rows and is structurally incapable of reaching an
 * athlete who is not theirs. That is a stronger guarantee than checking an id the
 * client supplied, and it is why this route has no ownership assertion to get
 * wrong.
 *
 * An athlete calling it gets an empty list rather than an error: they have no
 * roster, which is a true and uninteresting answer, not a permission failure.
 */
@Controller('adherence')
export class AdherenceController {
  constructor(private readonly adherenceService: AdherenceService) {}

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Query() query: AdherenceQueryDto, @Req() req: RequestWithUser) {
    return this.adherenceService.listAdherence(query.days, req.user.id);
  }
}
