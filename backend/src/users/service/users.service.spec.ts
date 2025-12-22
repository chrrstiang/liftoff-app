import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { Gender } from '../dto/create-user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let supabase: jest.Mocked<SupabaseClient>;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
  };

  const mockCreateUserDto = {
    first_name: 'John',
    last_name: 'Doe',
    username: 'johndoe',
    gender: Gender.MALE,
    date_of_birth: '1990-01-01',
    is_athlete: true,
    is_coach: false,
    federation_id: 'fed-123',
    division_id: 'div-123',
    weight_class_id: 'wc-123',
  };

  const mockAthleteData = {
    id: mockUser.id,
    federation_id: mockCreateUserDto.federation_id,
    division_id: mockCreateUserDto.division_id,
    weight_class_id: mockCreateUserDto.weight_class_id,
  };

  const mockUserData = {
    first_name: mockCreateUserDto.first_name,
    last_name: mockCreateUserDto.last_name,
    username: mockCreateUserDto.username,
    gender: mockCreateUserDto.gender,
    date_of_birth: mockCreateUserDto.date_of_birth,
    is_athlete: mockCreateUserDto.is_athlete,
    is_coach: mockCreateUserDto.is_coach,
  };

  beforeEach(async () => {
    const mockSupabaseClient = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: mockAthleteData, error: null }),
        update: jest.fn().mockReturnValue({
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    supabase = mockSupabaseClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUserProfile', () => {
    it('should create an athlete profile when is_athlete is true', async () => {
      await service.createUserProfile(mockCreateUserDto, mockUser as User);

      // Verify athlete profile was created
      expect(supabase.from).toHaveBeenCalledWith('athletes');
      expect(supabase.from('athletes').insert).toHaveBeenCalledWith(mockAthleteData);

      // Verify user data was updated
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(supabase.from('users').update).toHaveBeenCalledWith(mockUserData);
      expect(supabase.from('users').update(mockUserData).eq).toHaveBeenCalledWith(
        'id',
        mockUser.id,
      );
    });

    it('should create a coach profile when is_coach is true', async () => {
      const coachDto = {
        ...mockCreateUserDto,
        is_coach: true,
        biography: 'Experienced coach',
        years_of_experience: 5,
      };

      await service.createUserProfile(coachDto, mockUser as User);

      // Verify coach profile was created
      expect(supabase.from).toHaveBeenCalledWith('coaches');
      expect(supabase.from('coaches').insert).toHaveBeenCalledWith({
        id: mockUser.id,
        biography: coachDto.biography,
        years_of_experience: coachDto.years_of_experience,
      });
    });

    it('should throw BadRequestException when user update fails', async () => {
      const error = { code: '23505', message: 'User update failed' };
      supabase.from('users').update = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ error }),
      });

      await expect(service.createUserProfile(mockCreateUserDto, mockUser as User)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when athlete creation fails', async () => {
      const error = { code: '23505', message: 'Athlete creation failed' };
      supabase.from('athletes').insert = jest.fn().mockReturnValue({ error });

      await expect(service.createUserProfile(mockCreateUserDto, mockUser as User)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateProfile', () => {
    // Placeholder for updateProfile tests
    it('should be implemented', () => {
      expect(true).toBe(true);
    });
  });
});
