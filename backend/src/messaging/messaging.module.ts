import { Module } from '@nestjs/common';
import { ConversationsController } from './controller/conversations.controller';
import { ConversationsService } from './service/conversations.service';
import { SupabaseModule } from 'src/supabase/supabase.module';

/** SupabaseModule is imported only because JwtAuthGuard verifies tokens against
 * Supabase Auth. No data in this module touches Supabase. */
@Module({
  imports: [SupabaseModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class MessagingModule {}
