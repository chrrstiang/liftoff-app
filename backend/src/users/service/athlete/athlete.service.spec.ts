import { BadRequestException } from '@nestjs/common';
import { AthleteService } from './athlete.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Gender } from 'src/users/dto/create-user.dto';
import { PUBLIC_PROFILE_QUERY } from 'src/common/types/select.queries';

/** Unit tests for Athlete Service class:
 * 
 * - Profile creation, update and retrieve methods tested, ensuring proper
 * calls of methods with proper data. Also tests that the correct exceptions 
 * and messages are thrown.
 * 
 */

describe('AthleteService', () => {
  let service: AthleteService;
  let supabase: SupabaseClient;
  let dto;
  let user;
  let addToTable;
  let mockUsersChain;
  let mockEq; 

  beforeEach(async () => {
    const queries = {
      insert: jest.fn().mockResolvedValue({
        data: {},
        error: null
      }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'weight-class-id'
                }
              })
            }),
            single: jest.fn().mockResolvedValue({
              data: {
                id : 'division-id'
              }
            })
          }),
          single: jest.fn().mockResolvedValue({
            data: {
              name: 'christian',
              username: 'chrrstian'
            },
            error: null
          })
        })
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: {id: 'Some id'}, error: null }),
      }) 
    }

    supabase = {
      from: jest.fn().mockReturnValue(queries)
    } as unknown as jest.Mocked<SupabaseClient>;

    const supabaseService = {
      getClient: jest.fn().mockReturnValue(supabase)
    } as unknown as jest.Mocked<SupabaseService>;

    service = new AthleteService(supabaseService);

    dto = {
      name: 'Christian',
      username: 'chrrstian_',
      gender: Gender.MALE,
      date_of_birth: '2005-11-22',
      federation: "IPF",
      weight_class: '67.5kg',
      division: 'Junior'
    }

    user = {
      id: 'user-uuid'
    }

    addToTable = jest.spyOn(service as any, 'addToTable');

    mockUsersChain = {
      update: jest.fn().mockReturnValue({ eq: mockEq })
    };

    mockEq = jest.fn().mockResolvedValue({ error: null });
  });

  it('createProfile should succeed and call addToTable', async () => {

    const findFed = jest.spyOn(service as any, 'findFederation').mockResolvedValue('fed-id');
    const findDiv = jest.spyOn(service as any, 'findDivision').mockResolvedValue('div-id');
    const findWC = jest.spyOn(service as any, 'findWeightClass').mockResolvedValue('wc-id');

    const athleteData = {
      federation_id: 'fed-id',
      weight_class_id: 'wc-id',
      division_id: 'div-id',
      user_id: user.id
    }

    const userData = {
      name: dto.name,
      username: dto.username,
      gender: dto.gender,
      date_of_birth: dto.date_of_birth,
      role: 'Athlete'
    }

    const call = service.createProfile(dto, user)

    await expect(call).resolves.not.toThrow();
    expect(supabase.from('users').update).toHaveBeenCalledWith(userData);
    expect(addToTable).toHaveBeenCalledWith(athleteData, 'athletes');
    expect(addToTable).toHaveBeenCalledTimes(1);
  });

  it('createProfile should throw an error when insert returns an error', async () => {

    supabase.from('athletes').insert = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'I failed to insert',
        code: '23505'
      }
    })

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`An unexpected error occured for insert:
      23505 - I failed to insert`));
    expect(supabase.from('athletes').insert).toHaveBeenCalledTimes(1);
  });

  it('createProfile should throw an error when update returns an error', async () => {

    const dto = {name: 'name', username: 'user', gender: Gender.MALE, 
      date_of_birth: '2005-11-22'}

    supabase.from('users').update(dto).eq = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'I failed to update',
        code: '23505'
      }
    })

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`Failed to update user upon profile completion: 23505 - I failed to update`));
    expect(supabase.from('users').update(dto).eq).toHaveBeenCalledTimes(1);
  });

  it('createProfile should throw an error when DTO contains weight class and no federation', async () => {

    dto.federation = undefined;

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`Weight class requires a federation and gender`));
    expect(supabase.from('users').update(dto).eq).toHaveBeenCalledTimes(0);
  });

  it('createProfile should throw an error when DTO contains weight class and no gender', async () => {

    dto.gender = undefined;

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`Weight class requires a federation and gender`));
  });

  it('createProfile should throw an error when DTO contains division and no federation', async () => {

    dto.federation = undefined;
    dto.weight_class = undefined;

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`Division requires a federation`));
  });

  it('createProfile should throw an error when findFederation select returns no data', async () => {

    supabase.from('federations').select('id').eq('code', dto.federation).single = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '10101',
        message: "Fed doesn't exist"
      }
    })

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`An unexpected error occured for select:
      10101 - Fed doesn't exist`));
    expect(supabase.from('federations').select('id').eq('code', "IPF").single).toHaveBeenCalledTimes(1);
  });

  it('createProfile should throw an error when findDivision select returns no data', async () => {

    const fedId = jest.spyOn(service as any, 'findFederation').mockResolvedValue('IPF ID');

    supabase.from('divisions')
    .select('id')
    .eq('federation_id', fedId)
    .eq('division_name', dto.division).single = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '10101',
        message: "Division doesn't exist"
      }
    })

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`An unexpected error occured for select:
      10101 - Division doesn't exist`));
    expect(supabase.from('divisions').select('id').eq('federation_id', fedId)
    .eq('division_name', dto.division).single).toHaveBeenCalledTimes(1);
  });

  it('createProfile should throw an error when findWeightClass select returns no data', async () => {

    const fedId = jest.spyOn(service as any, 'findFederation').mockResolvedValue('IPF ID');

    supabase.from('weight_classes')
    .select('id')
    .eq('federation_id', fedId)
    .eq('gender', dto.gender)
    .eq('className', dto.weight_class).single = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '10101',
        message: "Weight class doesn't exist"
      }
    })

    const call = service.createProfile(dto, user)

    await expect(call).rejects.toThrow(new BadRequestException(`An unexpected error occured for select:
      10101 - Weight class doesn't exist`));
    expect(supabase.from('weight_classes')
    .select('id')
    .eq('federation_id', fedId)
    .eq('gender', dto.gender)
    .eq('className', dto.weight_class).single).toHaveBeenCalledTimes(1);
  });

  it('updateProfile should successfully call update on \'athletes\' without throwing any errors', async () => {

    let dto = {
      federation: 'IPF',
      division: 'Junior',
      weight_class: '59kg'
    }

    const updateCall = service.updateAthleteProfile(user, dto)

    await expect(updateCall).resolves.not.toThrow();
    expect(supabase.from).toHaveBeenCalledWith('athletes');
    expect(supabase.from('athletes').update).toHaveBeenCalledTimes(1);
  })

  it('updateProfile should throw an exception when update returns an error', async () => {
    let dto = {
      federation: 'IPF',
      division: 'Junior',
      weight_class: '59kg'
    }

    supabase.from('users').update(dto).eq = jest.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'I failed',
        code: 45404
      }
    })

    const updateCall = service.updateAthleteProfile(user, dto);

    await expect(updateCall).rejects.toThrow(new BadRequestException(
      `An unexpected error occured for update:
      45404 - I failed`))
    expect(supabase.from('athletes').update).toHaveBeenCalledWith(dto);
  })

  it('retrieveProfileDetails should successfully passes the correct query to select for \'users\'', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', ['users.name', 'users.username']);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith(`users (name, username)`);
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should successfully passes the correct query to select for \'athletes\'', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', ['weight_classes', 'divisions']);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith(`weight_classes (*), divisions (*)`)
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should successfully passes the correct query to select all (no arg)', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', undefined);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith(PUBLIC_PROFILE_QUERY)
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should successfully passes the correct query to select all (individual)', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', ['users.name', 'users.username', 'users.email', 'weight_classes', 'divisions']);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith('users (name, username, email), weight_classes (*), divisions (*)')
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should successfully get rid of duplciate queries', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', ['users.name', 'users.name', 'users.email', 'weight_classes', 'divisions']);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith('users (name, email), weight_classes (*), divisions (*)')
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should successfully get rid of nested field due to full table query', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', ['users.name', 'users.username', 'users.email', 'weight_classes', 'weight_classes.name']);

    expect(supabase.from('athletes').select).toHaveBeenCalledWith('users (name, username, email), weight_classes (*)')
    expect(supabase.from('athletes').select).toHaveBeenCalledTimes(1);
  })

  it('retrieveProfileDetails should fail due to invalid direct column (name)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', ['name', 'users.username', 'users.email', 'weight_classes', 'divisions']);

    await expect(call).rejects.toThrow(new BadRequestException(`Invalid query: 'name'`))
  })

  it('retrieveProfileDetails should fail due to invalid nested column (federation.horse)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', ['users.name', 'users.username', 'users.email', 'federation.horse']);

    await expect(call).rejects.toThrow(new BadRequestException(`Invalid query: 'federation.horse'`))
  })

  it('retrieveProfileDetails should fail due to invalid table query (users)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', ['users']);

    await expect(call).rejects.toThrow(new BadRequestException(`Invalid query: 'users'`))
  })

  // Add your specific tests here
});