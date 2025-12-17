import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';

/** This guard ensures that the authenticated user is logged in. A token received from logging
 * in is passed to the request header, and used to find the authenticated user. Then, the extracted user
 * is assigned to the request object for later reference once the request proceeds.
 * 
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // Verify token with Supabase
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.getUser(token);
      
      if (error || !data.user) {
        throw new UnauthorizedException('Invalid token');
      }
      
      // Attach user to request object
      request.user = data.user;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Token validation failed');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}