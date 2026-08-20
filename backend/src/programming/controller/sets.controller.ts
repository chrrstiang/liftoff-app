import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { WorkoutsService } from '../service/workouts.service';
import { UpdateSetDto } from '../dto/update-set.dto';

/** Set logging.
 *
 * A separate controller because the path is `/sets/:id` while the logic belongs to
 * WorkoutsService — a set is only ever reachable through its workout, and that walk
 * is where the authorization lives.
 */
@Controller('sets')
export class SetsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSetDto,
    @Req() req: RequestWithUser,
  ) {
    return this.workoutsService.updateSet(id, dto, req.user.id);
  }
}
