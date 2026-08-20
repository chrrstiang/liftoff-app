import { Module } from '@nestjs/common';
import { CoachRequestsController } from './controller/coach-requests.controller';
import { CoachRequestsService } from './service/coach-requests.service';
import { SupabaseModule } from 'src/supabase/supabase.module';

/** SupabaseModule is imported only because JwtAuthGuard verifies tokens against
 * Supabase Auth. No data in this module touches Supabase. */
@Module({
  imports: [SupabaseModule],
  controllers: [CoachRequestsController],
  providers: [CoachRequestsService],
})
export class CoachingModule {}
