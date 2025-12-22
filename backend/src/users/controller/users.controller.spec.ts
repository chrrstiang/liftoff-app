import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './users.controller';
import { UsersService } from '../service/users.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { CreateUserDto, Gender } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { RequestWithUser } from 'src/common/types/request.interface';

describe('UserController', () => {
  let controller: UserController;

  const mockUsersService = {
    createUserProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
  };

  const mockRequest = {
    user: mockUser,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createUserProfile', () => {
    it('should call usersService.createUserProfile with correct parameters', async () => {
      const createUserDto: CreateUserDto = {
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

      await controller.createUserProfile(createUserDto, mockRequest as RequestWithUser);

      expect(mockUsersService.createUserProfile).toHaveBeenCalledWith(createUserDto, mockUser);
    });

    it('should return success message on successful profile creation', async () => {
      const createUserDto: CreateUserDto = {
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        gender: Gender.MALE,
        date_of_birth: '1990-01-01',
        is_athlete: true,
        is_coach: false,
      };

      const result = await controller.createUserProfile(
        createUserDto,
        mockRequest as RequestWithUser,
      );

      expect(result).toEqual({ message: 'User profile created successfully!' });
    });
  });

  describe('updateProfile', () => {
    it('should call usersService.updateProfile with correct parameters', async () => {
      const updateUserDto: UpdateUserDto = {
        username: 'newusername',
        name: 'New Name',
      };

      await controller.updateProfile(updateUserDto, mockRequest as RequestWithUser);

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(updateUserDto, mockUser);
    });

    it('should return success message on successful profile update', async () => {
      const updateUserDto: UpdateUserDto = {
        username: 'newusername',
      };

      const result = await controller.updateProfile(updateUserDto, mockRequest as RequestWithUser);

      expect(result).toEqual({ message: 'User profile updated successfully' });
    });
  });
});
