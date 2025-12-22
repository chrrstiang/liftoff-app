import { Module } from '@nestjs/common';
import { IsUniqueValidator } from './unique.validator';
import { ValueExistsValidator } from './value-exists.validator';
import { SupabaseModule } from 'src/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [
    IsUniqueValidator,
    ValueExistsValidator,
    // Add any future validators here
  ],
  exports: [
    IsUniqueValidator,
    ValueExistsValidator,
    // Export them so other modules can use them
  ],
})
export class ValidatorsModule {}
