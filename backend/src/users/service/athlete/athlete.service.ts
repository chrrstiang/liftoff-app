import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';
import {
  PUBLIC_PROFILE_QUERY,
  VALID_ATHLETES_COLUMNS_QUERIES,
  VALID_FULL_TABLE_QUERIES,
  VALID_TABLE_FIELDS,
} from 'src/common/types/select.queries';
import { UsersService } from '../users.service';

/** The AthleteService class contains business logic for the API endpoints of the AthleteController.
 *  This contains operations such as inserting/updating athlete profiles to Supabase and
 * retrieveing profile details of an Athlete.
 *
 */
interface CreateAthleteData {
  id: string;
  federation_id?: string;
  division_id?: string;
  weight_class_id?: string;
}

interface UpdateAthleteData {
  federation_id?: string;
  division_id?: string;
  weight_class_id?: string;
}

@Injectable()
export class AthleteService {
  supabase: SupabaseClient;

  constructor(private readonly supabaseService: SupabaseService) {
    if (!this.supabaseService) {
      throw new InternalServerErrorException('SupabaseService is undefined');
    }
    this.supabase = this.supabaseService.getClient();
  }

  // adds the object containing specific fields to the designated table.
  private async addToTable(data: any, table: string) {
    const { error } = await this.supabase.from(table).insert(data);

    if (error) {
      UsersService.handleSupabaseError(error, `Failed to insert data into ${table}`);
    }
  }

  /** Queries the 'athletes' table for the row with the same user_id as the current authenticated
   * user's id, fetching information requested in the data array. If undefined,
   * then it selects all columns in the athletes table.
   *
   * @param user The user containing the authenticated user's id.
   * @param data An array containing the columns of the profile to return.
   * @returns An object containing the values of the columns requested.
   */
  async retrieveProfileDetails(athleteId: string, data?: string[]) {
    const cleanArray = this.cleanDataArray(data);
    const query = this.constructSelectQuery(cleanArray);

    const select = await this.supabase.from('athletes').select(query).eq('id', athleteId).single();

    if (select.error) {
      UsersService.handleSupabaseError(select.error, 'Failed to retrieve profile details');
    }

    return select.data;
  }

  /** This helper method ensure that duplicate queries and redundant queries for retrieveProfileDetails
   * are removed. This includes:
   * - same field: [federation_id, federation_id, name] -> [federation_id, name]
   * - field from object: [federation, federation.id,] -> [federation]
   *
   * @param fields The array containing the fields of the query.
   * @returns A clean array of columns/fields to create a query with.
   */
  private cleanDataArray(fields?: string[]): string[] | undefined {
    if (!fields || fields.length === 0) {
      return undefined;
    }

    // Basic deduplication
    const uniqueFields = [...new Set(fields)];

    // Handle full table vs nested field conflicts
    const fullTables = uniqueFields.filter((f) => !f.includes('.') && VALID_FULL_TABLE_QUERIES[f]);

    // If we have full table requests, remove conflicting nested requests
    if (fullTables.length > 0) {
      return uniqueFields.filter((field) => {
        if (!field.includes('.')) return true;

        const [tableName] = field.split('.');
        return !fullTables.includes(tableName);
      });
    }

    return uniqueFields;
  }

  /** This helper method is responsible for creating select queries for retrieveProfileDetails.
   * Examples of...
   * Direct queries: 'user_id', 'federation_id' (in 'athletes' table)
   * Nested queries: 'federation.id', 'users.name', (in a relational table)
   * Table queries: 'federation', 'division' (row of a relational table)
   *
   * @param data The array containing the data to be retrieved.
   * @returns A query ready to immediately insert into a select query.
   */
  private constructSelectQuery(data?: string[]) {
    if (!data) {
      return PUBLIC_PROFILE_QUERY;
    }

    const directFields: string[] = [];
    const nestedFields = {};

    data.forEach((c) => {
      // if nested field (federation.name)
      if (c.includes('.')) {
        const [tableName, column] = c.split('.');

        if (!VALID_TABLE_FIELDS[tableName]?.includes(column)) {
          throw new BadRequestException(`Invalid query: '${tableName}.${column}'`);
        }

        if (!nestedFields[tableName]) {
          nestedFields[tableName] = [];
        }
        nestedFields[tableName].push(column);
        // if field is a full row request (federation)
      } else if (VALID_FULL_TABLE_QUERIES.has(c)) {
        nestedFields[c] = ['*'];
        // if a normal request (federation_id)
      } else {
        if (!VALID_ATHLETES_COLUMNS_QUERIES.has(c)) {
          throw new BadRequestException(`Invalid query: '${c}'`);
        }
        directFields.push(c);
      }
    });

    // sets up query with normal fields first
    const queryParts = [...directFields];

    // construct parts of query for queries like federation.name & provides alias to match client input
    Object.entries(nestedFields).forEach(
      ([tableName, columns]: [table: string, columns: string[]]) => {
        if (columns.includes('*')) {
          queryParts.push(`${tableName} (*)`);
        } else {
          queryParts.push(`${tableName} (${columns.join(', ')})`);
        }
      },
    );

    return queryParts.join(', ');
  }
}
