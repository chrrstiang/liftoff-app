import { Controller, Get, HttpCode } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Liveness probe for the ALB target group.
   *
   * ⚠️ **Deliberately does not touch Supabase.** A health check that queries the
   * database fails whenever the database hiccups, which makes the load balancer
   * pull healthy tasks out of service and replace them — turning a transient
   * upstream blip into an outage of your own making. This answers only "is this
   * process up and serving HTTP".
   *
   * No guard, so it is reachable unauthenticated: the ALB has no credentials.
   * Guards on this codebase are applied per-route, so omitting one is the whole
   * mechanism — don't add a class-level guard to this controller.
   */
  @Get('health')
  @HttpCode(200)
  getHealth(): { status: string; version: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      // Baked into the image at build time (Dockerfile ARG GIT_SHA). This is what
      // makes a rollout verifiable: it is the only value that differs between the
      // old container and the new one, so the deploy can poll for it instead of
      // guessing from ECS metadata.
      //
      // Every previous attempt at this check decayed. `service.status.statusCode`
      // is ACTIVE before, during and after a rollout.
      // `activeConfigurations[0].taskDefinitionArn` reports the revision the
      // service was *told* to run, so it matches one second after the update call
      // and proves nothing. A hardcoded canary route (`/coach-requests` 401 vs 404)
      // works exactly once, then becomes old code itself and silently passes
      // forever. A build SHA cannot rot in any of those ways.
      version: process.env.GIT_SHA ?? 'unknown',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
