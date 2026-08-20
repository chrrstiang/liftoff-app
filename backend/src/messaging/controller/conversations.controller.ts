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
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import type { RequestWithUser } from 'src/common/types/request.interface';
import { ConversationsService } from '../service/conversations.service';
import { CreateConversationDto } from '../dto/create-conversation.dto';
import { SendMessageDto } from '../dto/send-message.dto';

/** Conversations and messages.
 *
 * Guards are per route, matching the rest of the codebase. Every handler passes
 * `req.user.id` and the route's conversation id — the caller never gets to name
 * who they are or, on send, who the sender is.
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  /** The endpoint whose absence made messaging unreachable for every new user. */
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateConversationDto, @Req() req: RequestWithUser) {
    const { id, created } = await this.conversationsService.createConversation(
      dto.participant_id,
      req.user.id,
    );
    return {
      conversation_id: id,
      message: created ? 'Conversation created successfully!' : 'Conversation already exists.',
    };
  }

  @Get()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: RequestWithUser) {
    return this.conversationsService.listConversations(req.user.id);
  }

  @Get(':id/messages')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async messages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithUser,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    return this.conversationsService.listMessages(
      id,
      req.user.id,
      Number.isFinite(parsed) && parsed > 0 ? parsed : 50,
      before,
    );
  }

  @Post(':id/messages')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async send(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendMessageDto,
    @Req() req: RequestWithUser,
  ) {
    const created = await this.conversationsService.sendMessage(
      id,
      req.user.id,
      dto.content,
      dto.message_type ?? 'text',
      dto.media_url,
    );
    return { id: created.id, sent_at: created.createdAt };
  }

  @Post(':id/read')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async read(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RequestWithUser) {
    await this.conversationsService.markAsRead(id, req.user.id);
    return { message: 'Marked as read.' };
  }
}
