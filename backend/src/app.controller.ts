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
  getHealth(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
