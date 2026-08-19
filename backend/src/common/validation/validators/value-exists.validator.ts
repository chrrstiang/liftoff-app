import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { resolveValidatableColumn } from './validation-columns';

/** Checks that a value exists for the given table and column — the inverse of
 * IsUniqueValidator, and it shares the same column registry.
 */
@ValidatorConstraint({ name: 'valueExists', async: true })
@Injectable()
export class ValueExistsValidator implements ValidatorConstraintInterface {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async validate(value: unknown, args?: ValidationArguments): Promise<boolean> {
    if (!this.db) {
      console.error('Database not injected into ValueExistsValidator');
      return false;
    }

    if (!args?.constraints || args.constraints.length < 2) {
      console.error('Missing constraints for ValueExistsValidator');
      return false;
    }

    // Guard before building SQL. Interpolating undefined into a template produced
    // `where "users"."username" =  limit $1` -- a syntax error, surfaced as a 500.
    // A missing value does not exist, by definition. Optionality is the DTO's job.
    if (value === null || value === undefined || value === '') {
      return false;
    }

    const [tableName, columnName] = args.constraints as [string, string];
    const column = resolveValidatableColumn(tableName, columnName);

    if (!column) {
      console.error(`ValueExistsValidator: ${tableName}.${columnName} is not registered`);
      return false;
    }

    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(column.table)
      .where(sql`${column} = ${value}`)
      .limit(1);

    return rows.length > 0;
  }

  defaultMessage(args?: ValidationArguments): string {
    if (!args?.constraints || args.constraints.length < 2) {
      return `${args?.property} is not a valid value.`;
    }
    const [column] = args.constraints as [string];
    return `${args?.property} is not a valid value for ${column}.`;
  }
}
