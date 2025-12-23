import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PostgrestError, SupabaseClient, User } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { UpdateUserDto } from '../dto/update-user.dto';
import { CreateUserDto, Gender } from '../dto/create-user.dto';
import { AthleteData } from '../entities/AthleteData';
import { CoachData } from '../entities/CoachData';
import { UserData } from '../entities/UserData';

@Injectable()
export class UsersService {
  supabase: SupabaseClient;

  constructor(private readonly supabaseService: SupabaseService) {
    if (!this.supabaseService) {
      throw new InternalServerErrorException('SupabaseService is undefined');
    }
    this.supabase = this.supabaseService.getClient();
  }

  async createUserProfile(dto: CreateUserDto, user: User) {
    const coachData: CoachData = {
      id: user.id,
      biography: dto.biography,
      years_of_experience: dto.years_of_experience,
    };
    const athleteData: AthleteData = {
      id: user.id,
      federation_id: dto.federation_id,
      division_id: dto.division_id,
      weight_class_id: dto.weight_class_id,
    };
    const userData: UserData = {
      first_name: dto.first_name,
      last_name: dto.last_name,
      username: dto.username,
      gender: dto.gender,
      date_of_birth: dto.date_of_birth,
      is_athlete: dto.is_athlete,
      is_coach: dto.is_coach,
    };

    if (dto.is_coach) {
      await this.createProfile(coachData, 'coaches');
    }

    if (dto.is_athlete) {
      if (dto.division_id) {
        await this.validateDivision(dto.division_id, dto.federation_id);
      }

      if (dto.weight_class_id) {
        await this.validateWeightClass(dto.weight_class_id, dto.federation_id, dto.gender);
      }
      await this.createProfile(athleteData, 'athletes');
    }

    const { error } = await this.supabase.from('users').update(userData).eq('id', user.id);

    if (error) {
      UsersService.handleSupabaseError(error, 'Failed to create user profile');
    }
  }

  private async createProfile(data: AthleteData | CoachData, table: string) {
    const { error } = await this.supabase.from(table).insert(data);
    if (error) {
      UsersService.handleSupabaseError(error, `Failed to create ${table} profile`);
    }
  }

  /** Given a DTO containing a name and/or username, the users row with the
   * same id as the current user is updated.
   *
   * @param updateUserDto The DTO containing the updated column value.
   */
  async updateProfile(dto: UpdateUserDto, user: User) {
    const { error } = await this.supabase.from('users').update(dto).eq('id', user.id);

    if (error) {
      UsersService.handleSupabaseError(error, 'Failed to update user profile');
    }
  }

  // given an error returned by Supabase, displays an appropriate message
  static handleSupabaseError(error: PostgrestError, message: string) {
    console.log(error);
    throw new BadRequestException(`${message}: ${error.code} - ${error.message}`);
  }

  private async validateDivision(division_id: string, federation_id: string | undefined) {
    if (!federation_id) {
      throw new BadRequestException('Federation is required to validate division');
    }
    const { data, error } = await this.supabase
      .from('divisions')
      .select('id')
      .eq('id', division_id)
      .eq('federation_id', federation_id)
      .single();

    if (error) {
      UsersService.handleSupabaseError(error, 'Failed to validate division');
    }

    if (!data?.id) {
      throw new BadRequestException('Division not found');
    }
  }

  private async validateWeightClass(
    weight_class_id: string,
    federation_id: string | undefined,
    gender: Gender,
  ) {
    if (!federation_id) {
      throw new BadRequestException('Federation is required to validate weight class');
    }

    const { data, error } = await this.supabase
      .from('weight_classes')
      .select('id')
      .eq('id', weight_class_id)
      .eq('federation_id', federation_id)
      .eq('gender', gender)
      .single();

    if (error) {
      UsersService.handleSupabaseError(error, 'Failed to validate weight class');
    }

    if (!data?.id) {
      throw new BadRequestException('Weight class not found');
    }
  }
}
