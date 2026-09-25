import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtVerifier } from 'src/common/validation/jwt-verifier';
import { RequestWithUser } from 'src/common/types/request.interface';

/** Requires a valid Supabase access token, and attaches the user it names to the
 * request for everything downstream to scope against.
 *
 * ⚠️ **The verification itself moved to `JwtVerifier`.** It lived here as a set of
 * private methods, which made this guard the only thing in the process able to
 * verify a token — so a WebSocket handshake, or anything else outside the HTTP
 * request path, would have had to write a second implementation. Two verifiers
 * that drift apart is a data breach rather than a bug, and there is no RLS behind
 * any of this to catch it.
 *
 * What is left here is what is genuinely about *HTTP*: pulling the bearer token
 * off the header, and putting the user on the request. The contract is unchanged —
 * same `No token provided`, same opaque `Invalid token`, same rethrow of an
 * exception the verifier already shaped.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtVerifier: JwtVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: RequestWithUser = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    request.user = await this.jwtVerifier.verify(token);

    return true;
  }

  private extractTokenFromHeader(request: RequestWithUser): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }
    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
