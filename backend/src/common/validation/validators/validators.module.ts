import { Module } from '@nestjs/common';
import { IsUniqueValidator } from './unique.validator';
import { ValueExistsValidator } from './value-exists.validator';

/** DbModule is @Global, so DRIZZLE is available without importing it here. */
@Module({
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
