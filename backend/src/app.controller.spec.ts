import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!!!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('reports ok with an uptime and a timestamp', () => {
      const result = appController.getHealth();

      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    });

    /** The controller is constructed here with no SupabaseService provider at all.
     * If the health check ever grows a database dependency, this test fails to
     * compile or resolve — which is the point. An ALB check that queries Supabase
     * would deregister healthy tasks on any upstream blip. */
    it('does not depend on Supabase', () => {
      expect(() => appController.getHealth()).not.toThrow();
    });
  });
});
