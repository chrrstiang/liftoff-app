import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ValidatorsModule } from './common/validation/validators/validators.module';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { CoachingModule } from './coaching/coaching.module';
import { MessagingModule } from './messaging/messaging.module';
import { ProgrammingModule } from './programming/programming.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // DbModule is @Global, so DRIZZLE is injectable anywhere once this is here.
    DbModule,
    UsersModule,
    CoachingModule,
    MessagingModule,
    ProgrammingModule,
    // Supabase is auth-only: JwtAuthGuard verifies tokens against it. All data
    // access goes through DbModule.
    SupabaseModule,
    ValidatorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
