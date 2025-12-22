import { BadRequestException } from '@nestjs/common';
import { AthleteService } from './athlete.service';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { PUBLIC_PROFILE_QUERY } from 'src/common/types/select.queries';
import { Test, TestingModule } from '@nestjs/testing';

describe('AthleteService - retrieveProfileDetails', () => {
  let service: AthleteService;
  let supabase: jest.Mocked<SupabaseClient>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockAthleteData = {
      id: 'athlete-id',
      users: {
        name: 'test',
        username: 'testuser',
      },
    };

    const mockSupabaseClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAthleteData,
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as jest.Mocked<SupabaseClient>;

    const mockSupabaseService = {
      getClient: jest.fn().mockReturnValue(mockSupabaseClient),
    } as unknown as jest.Mocked<SupabaseService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AthleteService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<AthleteService>(AthleteService);
    supabase = mockSupabaseClient;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
  it('should successfully pass the correct query to select all (no arg)', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', undefined);
    expect(supabase.from).toHaveBeenCalledWith('athletes');
    expect(supabase.from('athletes').select).toHaveBeenCalledWith(PUBLIC_PROFILE_QUERY);
    expect(supabase.from('athletes').select(PUBLIC_PROFILE_QUERY).eq).toHaveBeenCalledWith(
      'id',
      'anyrandomuuid',
    );
    expect(
      supabase.from('athletes').select(PUBLIC_PROFILE_QUERY).eq('id', 'anyrandomuuid').single,
    ).toHaveBeenCalled();
  });
  it('should successfully pass the correct query to select all (individual)', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', [
      'users.name',
      'users.username',
      'weight_classes.name',
    ]);
    expect(supabase.from).toHaveBeenCalledWith('athletes');
    expect(supabase.from('athletes').select).toHaveBeenCalledWith(
      'id, users!inner(name, username), weight_classes!inner(name)',
    );
    expect(
      supabase
        .from('athletes')
        .select('id, users!inner(name, username), weight_classes!inner(name)').eq,
    ).toHaveBeenCalledWith('id', 'anyrandomuuid');
    expect(
      supabase
        .from('athletes')
        .select('id, users!inner(name, username), weight_classes!inner(name)')
        .eq('id', 'anyrandomuuid').single,
    ).toHaveBeenCalled();
  });
  it('should successfully get rid of duplicate queries', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', [
      'users.name',
      'users.name',
      'weight_classes.name',
      'weight_classes.name',
    ]);
    expect(supabase.from('athletes').select).toHaveBeenCalledWith(
      'id, users!inner(name), weight_classes!inner(name)',
    );
  });
  it('should successfully get rid of nested field due to full table query', async () => {
    await service.retrieveProfileDetails('anyrandomuuid', [
      'users.name',
      'users.username',
      'weight_classes',
    ]);
    expect(supabase.from('athletes').select).toHaveBeenCalledWith(
      'id, users!inner(*), weight_classes!inner(*)',
    );
  });
  it('should fail due to invalid direct column (name)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', [
      'name',
      'users.username',
      'weight_classes.name',
    ]);
    await expect(call).rejects.toThrow(new BadRequestException(`Invalid query: 'name'`));
  });
  it('should fail due to invalid nested column (federation.horse)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', [
      'users.name',
      'users.username',
      'federation.horse',
    ]);
    await expect(call).rejects.toThrow(
      new BadRequestException(`Invalid query: 'federation.horse'`),
    );
  });
  it('should fail due to invalid table query (users)', async () => {
    const call = service.retrieveProfileDetails('anyrandomuuid', ['users']);
    await expect(call).rejects.toThrow(new BadRequestException(`Invalid query: 'users'`));
  });
});
