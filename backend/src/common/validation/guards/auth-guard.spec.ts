import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { JwtAuthGuard } from './auth-guard';
import { SupabaseService } from 'src/supabase/supabase.service';
import { RequestWithUser } from 'src/common/types/request.interface';

/** Tests for the local JWT verification path.
 *
 * This guard is the entire trust boundary — there is no RLS behind it — so these
 * cover the forgeries as much as the happy path: a flipped signature bit, a token
 * signed with the wrong secret, `alg: none`, an algorithm swap, and an expired or
 * never-expiring token.
 *
 * Supabase is mocked with a `@nestjs/testing` provider override, the same way the
 * other unit specs do it, so nothing here touches the network. The mock doubles as
 * the assertion that local mode never calls out.
 */
describe('JwtAuthGuard', () => {
  const SECRET = 'test-only-jwt-secret-0123456789';
  const OTHER_SECRET = 'a-different-secret-entirely';

  /** A Supabase access token payload, minus whatever the test is exercising. */
  const baseClaims = {
    sub: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'user@example.invalid',
    app_metadata: { provider: 'email' },
    user_metadata: { first_name: 'Test' },
  };

  const mockGetUser = jest.fn();
  const mockSupabaseService = {
    getClient: () => ({ auth: { getUser: mockGetUser } }),
  };

  interface SignOptions {
    header?: Record<string, unknown>;
    secret?: string;
  }

  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  /** Mints a token the way Supabase does: HS256 over `header.payload`. */
  const sign = (claims: Record<string, unknown>, options: SignOptions = {}): string => {
    const { header = { alg: 'HS256', typ: 'JWT' }, secret = SECRET } = options;
    const signingInput = `${encode(header)}.${encode(claims)}`;
    const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
  };

  /** An unexpired token carrying the standard claims, plus any overrides. */
  const validToken = (overrides: Record<string, unknown> = {}, options: SignOptions = {}): string =>
    sign({ ...baseClaims, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides }, options);

  /** Compiles a guard with the given environment. */
  const build = async (env: Record<string, string | undefined>): Promise<JwtAuthGuard> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      ],
    }).compile();

    return module.get<JwtAuthGuard>(JwtAuthGuard);
  };

  /** An ExecutionContext wrapping a request with the given Authorization header. */
  const contextFor = (
    authorization?: string,
  ): { context: ExecutionContext; request: RequestWithUser } => {
    const request = {
      headers: authorization === undefined ? {} : { authorization },
    } as unknown as RequestWithUser;

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('local verification (SUPABASE_JWT_SECRET set)', () => {
    let guard: JwtAuthGuard;

    beforeEach(async () => {
      guard = await build({ SUPABASE_JWT_SECRET: SECRET });
    });

    it('should be defined', () => {
      expect(guard).toBeDefined();
    });

    it('accepts a validly signed, unexpired token', async () => {
      const { context, request } = contextFor(`Bearer ${validToken()}`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // `sub` becomes the id; the rest of the shape is what callers already read.
      expect(request.user.id).toBe('user-1');
      expect(request.user.email).toBe('user@example.invalid');
      expect(request.user.aud).toBe('authenticated');
      expect(request.user.app_metadata).toEqual({ provider: 'email' });
      expect(request.user.user_metadata).toEqual({ first_name: 'Test' });
    });

    it('never calls Supabase on the local path', async () => {
      const { context } = contextFor(`Bearer ${validToken()}`);

      await guard.canActivate(context);

      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('rejects a token whose signature has been tampered with', async () => {
      const token = validToken();
      // Flip one character of the signature, keeping the length identical so the
      // timing-safe compare — not the length guard — is what rejects it.
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      const { context } = contextFor(`Bearer ${tampered}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token whose payload was edited to impersonate another user', async () => {
      const token = validToken();
      const [header, , signature] = token.split('.');
      const forgedPayload = encode({ ...baseClaims, sub: 'someone-else', exp: 4102444800 });
      const { context } = contextFor(`Bearer ${header}.${forgedPayload}.${signature}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token signed with a different secret', async () => {
      const { context } = contextFor(`Bearer ${validToken({}, { secret: OTHER_SECRET })}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a signature of the wrong length without throwing from timingSafeEqual', async () => {
      const [header, payload] = validToken().split('.');
      const { context } = contextFor(`Bearer ${header}.${payload}.c2hvcnQ`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const { context } = contextFor(
        `Bearer ${validToken({ exp: Math.floor(Date.now() / 1000) - 60 })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with no exp claim, rather than treating it as never expiring', async () => {
      const { context } = contextFor(`Bearer ${sign({ ...baseClaims })}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects alg: none even when the rest of the token is well formed', async () => {
      const claims = { ...baseClaims, exp: Math.floor(Date.now() / 1000) + 3600 };
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
      const { context } = contextFor(`Bearer ${unsigned}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-HS256 alg even when the HMAC would otherwise match', async () => {
      // The signature here is a correct HS256 MAC; only the advertised alg differs.
      // A verifier that trusted the header would be forced down another code path.
      const { context } = contextFor(
        `Bearer ${validToken({}, { header: { alg: 'HS512', typ: 'JWT' } })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an RS256 header (algorithm confusion)', async () => {
      const { context } = contextFor(
        `Bearer ${validToken({}, { header: { alg: 'RS256', typ: 'JWT' } })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['garbage', 'not-a-jwt-at-all'],
      ['two segments', 'aaaa.bbbb'],
      ['four segments', 'aaaa.bbbb.cccc.dddd'],
      ['undecodable segments', 'aaaa.bbbb.cccc'],
      ['empty string', ''],
    ])('rejects a malformed token (%s)', async (_label, token) => {
      const { context } = contextFor(`Bearer ${token}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with an unexpected aud', async () => {
      const { context } = contextFor(`Bearer ${validToken({ aud: 'some-other-audience' })}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('accepts an aud array that contains the expected audience', async () => {
      const { context, request } = contextFor(
        `Bearer ${validToken({ aud: ['authenticated', 'other'] })}`,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.id).toBe('user-1');
    });

    it('rejects a token with no sub claim', async () => {
      const { sub: _sub, ...withoutSub } = baseClaims;
      const { context } = contextFor(
        `Bearer ${sign({ ...withoutSub, exp: Math.floor(Date.now() / 1000) + 3600 })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a request with no Authorization header', async () => {
      const { context } = contextFor();

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-Bearer Authorization scheme', async () => {
      const { context } = contextFor(`Basic ${validToken()}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('remote fallback (SUPABASE_JWT_SECRET unset)', () => {
    let guard: JwtAuthGuard;

    beforeEach(async () => {
      guard = await build({});
    });

    it('verifies through supabase.auth.getUser and attaches the user it returns', async () => {
      const remoteUser = { id: 'remote-user', email: 'remote@example.invalid' };
      mockGetUser.mockResolvedValue({ data: { user: remoteUser }, error: null });
      const { context, request } = contextFor('Bearer any-opaque-token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(mockGetUser).toHaveBeenCalledWith('any-opaque-token');
      expect(request.user).toBe(remoteUser);
    });

    it('rejects when Supabase reports an error', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
      const { context } = contextFor('Bearer any-opaque-token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('does not verify locally, so a token this process could not have signed still goes remote', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'remote-user' } }, error: null });
      const { context } = contextFor(`Bearer ${validToken({}, { secret: OTHER_SECRET })}`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(mockGetUser).toHaveBeenCalled();
    });

    it('still rejects a request with no Authorization header without calling out', async () => {
      const { context } = contextFor();

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });
});
