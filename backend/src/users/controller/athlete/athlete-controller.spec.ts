import { Test, TestingModule } from '@nestjs/testing';
import { AthleteController } from './athlete.controller';
import { AthleteService } from 'src/users/service/athlete/athlete.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';
import { UpdateAthleteDto } from 'src/users/dto/athlete/update-athlete.dto';
import { RequestWithUser } from 'src/common/types/request.interface';

describe('AthleteController', () => {
  let controller: AthleteController;

  const mockAthleteService = {
    retrieveProfileDetails: jest.fn(),
    updateOwnProfile: jest.fn(),
  };

  const mockUser = { id: 'caller-id', email: 'caller@example.invalid' };
  const mockRequest = { user: mockUser };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAthleteService.retrieveProfileDetails.mockResolvedValue({
      name: 'christian',
      username: 'chrrstian',
      weight_class: '67.5kg',
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AthleteController],
      providers: [
        {
          provide: AthleteService,
          useValue: mockAthleteService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AthleteExistsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AthleteController>(AthleteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('retrieveProfileDetails should return profile data from service', async () => {
    const result = await controller.retrieveProfileDetails(
      'some-uuid',
      'name,username,weight_class',
    );

    expect(mockAthleteService.retrieveProfileDetails).toHaveBeenCalledWith('some-uuid', [
      'name',
      'username',
      'weight_class',
    ]);
    expect(result).toEqual({
      name: 'christian',
      username: 'chrrstian',
      weight_class: '67.5kg',
    });
  });

  it('should call service with undefined when no data param provided', async () => {
    await controller.retrieveProfileDetails('some-uuid', undefined);

    expect(mockAthleteService.retrieveProfileDetails).toHaveBeenCalledWith('some-uuid', undefined);
  });

  describe('updateOwnProfile', () => {
    /** The route takes no id, so the only thing the controller can pass as the
     * actor is `req.user` — which the guard put there from the verified token.
     * This is the same rule that took the `userId` argument off the client's
     * avatar update. */
    it('passes the caller from the token, not anything in the body', async () => {
      const dto: UpdateAthleteDto = {
        federation_id: '33333333-3333-3333-3333-333333333333',
        weight_class_id: '55555555-5555-5555-5555-555555555555',
      };

      await controller.updateOwnProfile(dto, mockRequest as RequestWithUser);

      expect(mockAthleteService.updateOwnProfile).toHaveBeenCalledWith(dto, mockUser);
      expect(mockAthleteService.updateOwnProfile).toHaveBeenCalledTimes(1);
    });

    it('returns a success message', async () => {
      const result = await controller.updateOwnProfile({}, mockRequest as RequestWithUser);

      expect(result).toEqual({ message: 'Athlete profile updated successfully' });
    });
  });
});
