import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CreateAthleteDto } from 'src/users/dto/athlete/create-athlete.dto';
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';
import { PUBLIC_PROFILE_QUERY, VALID_ATHLETES_COLUMNS_QUERIES, VALID_FULL_TABLE_QUERIES, VALID_TABLE_FIELDS } from 'src/common/types/select.queries';
import { UsersService } from '../users.service';

/** The AthleteService class contains business logic for the API endpoints of the AthleteController.
 *  This contains operations such as inserting/updating athlete profiles to Supabase and
 * retrieveing profile details of an Athlete.
 * 
 */
@Injectable()
export class AthleteService {

  supabase: SupabaseClient;

  constructor(private readonly supabaseService: SupabaseService) {
    if (!this.supabaseService) {
      throw new InternalServerErrorException('SupabaseService is undefined');
    }
    this.supabase = this.supabaseService.getClient()
  }
  
  /** Handles the insertion of the new data from the Athlete profile completion
   * form. Adds data to its corresponding table.
   * 
   * @param dto The DTO containing the user/athlete data.
   */
  async createProfile(dto: CreateAthleteDto, user: any) {
    const user_id = user.id;

    this.validateCreateDTO(dto);

    let athleteData: CreateAthleteData = {user_id};

    if (dto.federation) {
      athleteData.federation_id = await this.findFederation(dto.federation);

      if (dto.division) {
        athleteData.division_id = await this.findDivision(athleteData.federation_id!, dto.division);
      }
  
      if (dto.weight_class) {
        athleteData.weight_class_id = await this.findWeightClass(athleteData.federation_id!, dto.gender, dto.weight_class);
      }
    }

    const { name, username, gender, date_of_birth, ...athleteFields} = dto;

    const { error } = await this.supabase
    .from('users')
    .update({ 
      name: name,
      username: username,
      gender: gender,
      date_of_birth: date_of_birth,
      role: 'Athlete'
    })
    .eq('id', user_id);

    if (error) {
      throw new BadRequestException(`Failed to update user upon profile completion: ${error.code} - ${error.message}`);
    }

    athleteData.user_id = user_id;

    await this.addToTable(athleteData, 'athletes');

  }

  /** Updates the data of the user'a athlete profile, including their federation, division,
   * and weight class. The DTO contains all three fields, and validates them through the helper methods.
   * 
   * @param user The user object containg the user id
   * @param dto The DTO containing the federation, division, and weight class
   * that the athlete profile will contain.
   */
  async updateAthleteProfile(user: any, dto: UpdateAthleteDto) {

    const { data: gender } = await this.supabase
    .from('users')
    .select('gender')
    .eq('id', user.id)
    .single();

    let updatedData: UpdateAthleteData = {};
    updatedData.federation_id = await this.findFederation(dto.federation);
    updatedData.division_id = await this.findDivision(updatedData.federation_id!, dto.division)
    updatedData.weight_class_id = await this.findWeightClass(
      updatedData.federation_id!, gender?.gender! as unknown as string, dto.weight_class)

    const { error } = await this.supabase
    .from('athletes')
    .update(updatedData)
    .eq('user_id', user.id)

    if (error) {
      UsersService.handleSupabaseError(error, 'Failed to update athlete information')
    }
  }

  // adds the object containing specific fields to the designated table.
  private async addToTable(data: any, table: string) {
    const { error } = await this.supabase.from(table).insert(data);

    if (error) {
     UsersService.handleSupabaseError(error, `Failed to insert data into ${table}`)
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

    const cleanArray = this.cleanDataArray(data)
    const query = this.constructSelectQuery(cleanArray);

    const select = await this.supabase
    .from('athletes')
    .select(query)
    .eq('id', athleteId)
    .single()

    if (select.error) {
      UsersService.handleSupabaseError(select.error, 'Failed to retrieve profile details')
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
    const fullTables = uniqueFields.filter(f => 
      !f.includes('.') && VALID_FULL_TABLE_QUERIES[f]
    );
    
    // If we have full table requests, remove conflicting nested requests
    if (fullTables.length > 0) {
      return uniqueFields.filter(field => {
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

    let directFields: string[] = [];
    let nestedFields = {};

    data.forEach(c => {
      // if nested field (federation.name)
      if (c.includes('.')) {
        const [tableName, column] = c.split('.');

        if (!VALID_TABLE_FIELDS[tableName]?.includes(column)) {
          throw new BadRequestException(`Invalid query: '${tableName}.${column}'`)
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
    Object.entries(nestedFields).forEach(([tableName, columns]: [table: string, columns: string[]]) => {
      if (columns.includes('*')) {
        queryParts.push(`${tableName} (*)`);
      } else {
        queryParts.push(`${tableName} (${columns.join(', ')})`);
      }
    });
    
    return queryParts.join(', ');
  }

  // searches for the weight class with the given federation id, gender, and weight class name.
  // if found, returns id. if not, throws exception.
  private async findWeightClass(fedId: string, gender: string, className: string) {
    const { data, error } = await this.supabase
    .from('weight_classes')
    .select('id')
    .eq('federation_id', fedId)
    .eq('gender', gender)
    .eq('name', className)
    .single()

    if (error || !data) {
      UsersService.handleSupabaseError(
        error, `Failed to locate weight class '${className}' with '${gender}' gender and given federation id`);
    }

    return data?.id;
  }

  // searches for federation using the federation code given, returns id if found.
  private async findDivision(fedId: string, divisionName: string) {
    const { data, error } = await this.supabase
    .from('divisions')
    .select('id')
    .eq('federation_id', fedId)
    .eq('name', divisionName)
    .single()

    if (error || !data) {
      UsersService.handleSupabaseError(
        error, `Failed to locate division '${divisionName}' with the given federation id`);
    }

    return data?.id;
  }

  // searches for federation using the federation code given, returns id if found.
  private async findFederation(federationCode: string) {
    const { data, error } = await this.supabase
    .from('federations')
    .select('id')
    .eq('code', federationCode)
    .single()

    if (error || !data) {
      UsersService.handleSupabaseError(
        error, `Failed to federation with code '${federationCode}'`);
    }

    return data?.id;
  }

  /* ensures that necessary fields are present in order to insert given fields with confidence.
  Ex. We can't confirm someone's weight class unless they confirm their gender and their federation,
  so we check to make sure those fields are present.
  */
  private validateCreateDTO(dto: CreateAthleteDto) {
    if (dto.weight_class && (!dto.federation || !dto.gender)) {
      throw new BadRequestException(`Weight class requires a federation and gender`);
    } else if (dto.division && !dto.federation) {
      throw new BadRequestException(`Division requires a federation`);
    }
  }
}
