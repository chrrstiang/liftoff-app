import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { WorkoutsController } from './controller/workouts.controller';
import { SetsController } from './controller/sets.controller';
import { ExercisesController } from './controller/exercises.controller';
import { MaxesController } from './controller/maxes.controller';
import { AdherenceController } from './controller/adherence.controller';
import { WorkoutsService } from './service/workouts.service';
import { ExercisesService } from './service/exercises.service';
import { MaxesService } from './service/maxes.service';
import { AdherenceService } from './service/adherence.service';

/** Workouts, sets and the exercise library.
 *
 * SupabaseModule is imported only because JwtAuthGuard verifies tokens against
 * Supabase Auth. No data in this module touches Supabase.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [
    WorkoutsController,
    SetsController,
    ExercisesController,
    MaxesController,
    AdherenceController,
  ],
  providers: [WorkoutsService, ExercisesService, MaxesService, AdherenceService],
})
export class ProgrammingModule {}
