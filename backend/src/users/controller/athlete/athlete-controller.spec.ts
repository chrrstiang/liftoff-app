import { Test, TestingModule } from '@nestjs/testing';
import { AthleteController } from './athlete.controller';
import { AthleteService } from 'src/users/service/athlete/athlete.service';
import { JwtAuthGuard } from 'src/common/validation/guards/auth-guard';
import { AthleteExistsGuard } from 'src/common/validation/guards/athlete-exists-guard';

describe('AthleteController', () => {
  let controller: AthleteController;

  const mockAthleteService = {
    retrieveProfileDetails: jest.fn(),
  };

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
});
