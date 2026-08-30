import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from 'src/supabase/supabase.service';
import { RequestWithUser } from 'src/common/types/request.interface';

/** The only algorithm this API will accept. Supabase signs access tokens with the
 * project's legacy JWT secret (HMAC-SHA256); the project's JWKS endpoint returns
 * `{"keys":[]}`, so there are no asymmetric keys in play and nothing else is valid.
 *
 * Hardcoding this is the whole point: the classic JWT forgery is an attacker
 * flipping `alg` in the header — to `none`, or to a symmetric algorithm whose
 * "secret" is a public key — and a verifier that trusts the header to pick its own
 * algorithm. We never read `alg` to decide what to do, only to reject.
 */
const REQUIRED_ALG = 'HS256';

/** Every Supabase access token carries `aud: "authenticated"`, anonymous sign-ins
 * included. Checked only when the claim is present, so a future token shape that
 * drops it does not lock everyone out.
 */
const EXPECTED_AUDIENCE = 'authenticated';

/** Startup mode is logged once per process, not once per guard instance — Nest
 * builds one JwtAuthGuard per module that uses it, which would otherwise be six
 * identical lines.
 */
let modeLogged = false;

/** Decoded JOSE header. Everything is optional because it is attacker-controlled. */
interface JwtHeader {
  alg?: string;
  typ?: string;
}

/** The Supabase access token claim set, narrowed to what we read. */
interface SupabaseJwtClaims {
  sub?: string;
  exp?: number;
  aud?: string | string[];
  email?: string;
  phone?: string;
  role?: string;
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

/** This guard ensures that the authenticated user is logged in. A token received from logging
 * in is passed to the request header, and used to find the authenticated user. Then, the extracted user
 * is assigned to the request object for later reference once the request proceeds.
 *
 * **Verification is local when `SUPABASE_JWT_SECRET` is set.** It used to always call
 * `supabase.auth.getUser(token)`, which is a network round trip to Supabase on *every*
 * authenticated request. Two problems with that:
 *
 * 1. **Latency.** Data lives in RDS inside the VPC, so Supabase is the only remote hop
 *    left in a request — it dominates the per-request budget for work that is a few
 *    microseconds of HMAC locally.
 * 2. **Availability.** When the Supabase project was recently PAUSED, *every*
 *    authenticated endpoint in production failed, not just login. The guard could not
 *    verify a token it already held all the information to verify. Coupling every read
 *    in the app to a third party's uptime is the real bug; the latency is just the bill.
 *
 * When the secret is absent we fall back to the remote call, so nothing breaks before
 * the secret is configured in an environment. The active mode is logged once at startup.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  /** The project's legacy JWT secret, or undefined to fall back to the remote check.
   * Never logged, never included in an error message.
   */
  private readonly jwtSecret: string | undefined;

  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>('SUPABASE_JWT_SECRET')?.trim() || undefined;

    if (!modeLogged) {
      modeLogged = true;
      this.logger.log(
        this.jwtSecret
          ? 'Verifying JWTs locally (HS256). SUPABASE_JWT_SECRET is set.'
          : 'SUPABASE_JWT_SECRET is not set — falling back to a remote supabase.auth.getUser() ' +
              'call on every authenticated request. Set it to verify locally.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: RequestWithUser = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Attach user to request object
    request.user = this.jwtSecret
      ? this.verifyLocally(token, this.jwtSecret)
      : await this.verifyWithSupabase(token);

    return true;
  }

  /** Verifies an HS256 token against the project's JWT secret without leaving the process.
   *
   * Every failure is reported as the same opaque `Invalid token` — a caller learns
   * nothing about *why* a forgery was rejected, and nothing about the token or the
   * secret is ever logged.
   *
   * @param token the raw bearer token
   * @param secret the project's legacy JWT secret
   * @returns the user carried by the token's claims
   */
  private verifyLocally(token: string, secret: string): User {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid token');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const header = this.decodeSegment<JwtHeader>(encodedHeader);
    // Rejects `alg: none` and every algorithm that is not the one we sign with.
    if (!header || header.alg !== REQUIRED_ALG) {
      throw new UnauthorizedException('Invalid token');
    }

    const expected = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const provided = Buffer.from(encodedSignature, 'base64url');

    // timingSafeEqual throws on a length mismatch, so the cheap length check has to
    // come first. It is not a leak: signature length is a function of the algorithm,
    // which is public.
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid token');
    }

    const claims = this.decodeSegment<SupabaseJwtClaims>(encodedPayload);
    if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new UnauthorizedException('Invalid token');
    }

    // A token with no `exp` never expires. Treat a missing or non-numeric one as
    // invalid rather than as "no expiry", and allow no clock skew.
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('Invalid token');
    }

    if (claims.aud !== undefined && !this.audienceMatches(claims.aud)) {
      throw new UnauthorizedException('Invalid token');
    }

    return this.toUser(claims);
  }

  /** The original path: ask Supabase to verify the token for us. Used only when
   * `SUPABASE_JWT_SECRET` is absent.
   *
   * @param token the raw bearer token
   * @returns the user Supabase resolves the token to
   */
  private async verifyWithSupabase(token: string): Promise<User> {
    try {
      // Verify token with Supabase
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid token');
      }

      return data.user;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new UnauthorizedException(`Token validation failed: ${error.message}`);
      }
      throw new UnauthorizedException('Token validation failed');
    }
  }

  /** Builds the `request.user` the rest of the app expects out of verified claims.
   *
   * Only `id` and `email` are read anywhere downstream, but the shape stays the
   * Supabase `User` so no caller has to change. `created_at` has no counterpart in
   * the token — the JWT simply does not carry it — so it is left empty rather than
   * faked from `iat`.
   *
   * @param claims verified claims from the token payload
   * @returns the user to attach to the request
   */
  private toUser(claims: SupabaseJwtClaims): User {
    return {
      id: claims.sub,
      aud: typeof claims.aud === 'string' ? claims.aud : EXPECTED_AUDIENCE,
      role: claims.role,
      email: claims.email,
      phone: claims.phone,
      app_metadata: claims.app_metadata ?? {},
      user_metadata: claims.user_metadata ?? {},
      is_anonymous: claims.is_anonymous,
      created_at: '',
    } as User;
  }

  /** `aud` is allowed to be a single value or an array (RFC 7519). */
  private audienceMatches(aud: string | string[]): boolean {
    return Array.isArray(aud) ? aud.includes(EXPECTED_AUDIENCE) : aud === EXPECTED_AUDIENCE;
  }

  /** base64url-decodes one JWT segment and parses it as JSON.
   *
   * @param segment a single dot-delimited token segment
   * @returns the parsed object, or undefined if it is not decodable JSON
   */
  private decodeSegment<T>(segment: string): T | undefined {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      return parsed as T;
    } catch {
      return undefined;
    }
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
