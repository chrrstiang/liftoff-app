import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

/** This validator is responsible for checking that the given value is unique,
 * in the context of the given table and column. If true, the validator passes.
 *
 */
@ValidatorConstraint({ name: 'isUnique', async: true })
@Injectable()
export class IsUniqueValidator implements ValidatorConstraintInterface {
  constructor(private readonly supabaseService: SupabaseService) {}

  async validate(
    value: any,
    validationArguments?: ValidationArguments,
  ): Promise<boolean> {
    if (!this.supabaseService) {
      console.error('SupabaseService not injected!');
      return false;
    }

    if (
      !validationArguments?.constraints ||
      validationArguments.constraints.length < 2
    ) {
      console.error('Missing constraints for IsUniqueValidator');
      return false;
    }
    const [tableName, column] = validationArguments?.constraints;
    const supabase = this.supabaseService.getClient();

    const { data } = (await (supabase as any)
      .from(tableName)
      .select('id')
      .eq(column, value)
      .maybeSingle()) as any;

    return !data;
  }
  defaultMessage?(validationArguments?: ValidationArguments): string {
    return `${validationArguments?.property} must be unique`;
  }
}
