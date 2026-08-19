import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from 'src/db/db.module';
import { resolveValidatableColumn } from './validation-columns';

/** Checks that a value is unique for the given table and column.
 *
 * The `useContainer(app.select(AppModule))` call in main.ts is what makes the
 * constructor injection here work. Without it this validator silently resolves
 * with no dependencies and every check passes — so any new e2e bootstrap must
 * repeat that call.
 */
@ValidatorConstraint({ name: 'isUnique', async: true })
@Injectable()
export class IsUniqueValidator implements ValidatorConstraintInterface {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async validate(value: unknown, args?: ValidationArguments): Promise<boolean> {
    if (!this.db) {
      console.error('Database not injected into IsUniqueValidator');
      return false;
    }

    if (!args?.constraints || args.constraints.length < 2) {
      console.error('Missing constraints for IsUniqueValidator');
      return false;
    }

    const [tableName, columnName] = args.constraints as [string, string];
    const column = resolveValidatableColumn(tableName, columnName);

    if (!column) {
      // Fail closed. An unregistered pair is a programming error, and passing
      // would mean silently skipping a uniqueness check.
      console.error(`IsUniqueValidator: ${tableName}.${columnName} is not registered`);
      return false;
    }

    // `select 1 ... limit 1` rather than fetching the row: this only needs to know
    // whether a match exists.
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(column.table)
      .where(sql`${column} = ${value}`)
      .limit(1);

    return rows.length === 0;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `${args?.property} must be unique`;
  }
}
