import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ValidatorsModule } from './common/validation/validators/validators.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({
      isGlobal: true,
    }), AuthModule, UsersModule, SupabaseModule, ValidatorsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
