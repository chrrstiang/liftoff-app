import { Test, TestingModule } from '@nestjs/testing';
import { CoachService } from '../../service/coach/coach.service';
import { CoachController } from './coach.controller';

describe('CoachController', () => {
  let controller: CoachController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoachController],
      providers: [CoachService],
    }).compile();

    controller = module.get<CoachController>(CoachController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
