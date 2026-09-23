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
      const [header, payload, signature] = token.split('.');

      // Flip a bit in the signature's first byte, keeping the encoded length
      // identical, so the timing-safe compare — not the length guard — is what
      // rejects it.
      //
      // ⚠️ Flip a *byte*, not a character. This used to swap the last character
      // for 'A' (or 'B' when it was already 'A'), which failed 6.2% of runs. A
      // 32-byte HMAC is 43 base64url characters, so the final character carries
      // only 4 significant bits and 2 padding bits: the reachable final
      // characters are `048AEIMQUYcgkosw`, and 'A' and 'B' differ *only* in
      // those padding bits. Whenever the real signature ended in 'A', the
      // "tampered" token decoded to byte-identical bytes, verified fine, and the
      // test failed — having quietly stopped testing forgery at all.
      const bytes = Buffer.from(signature, 'base64url');
      bytes[0] ^= 0x01;
      const tampered = `${header}.${payload}.${bytes.toString('base64url')}`;

      expect(tampered).toHaveLength(token.length);
      expect(tampered).not.toBe(token);

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

    /** ⚠️ **Absence used to pass.** The check ran only when `aud` was present, so
     * the token that most wanted to skip it — one whose audience is wrong or
     * missing — was the one that did. Supabase sets this on every access token,
     * anonymous sign-ins included, which is exactly what makes it requirable. */
    it('rejects a token with no aud claim, rather than skipping the check', async () => {
      const { aud: _aud, ...withoutAud } = baseClaims;
      const { context } = contextFor(
        `Bearer ${sign({ ...withoutAud, exp: Math.floor(Date.now() / 1000) + 3600 })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
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

    /** `iss` is checked only when `SUPABASE_JWT_ISSUER` names one, which is why
     * every test above — none of which set it — passes without an `iss` claim.
     * That is the documented default, not an oversight: see `ISSUER_VAR`. */
    it('ignores iss when no expected issuer is configured', async () => {
      const { context } = contextFor(`Bearer ${validToken({ iss: 'https://elsewhere/auth/v1' })}`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  /** The issuer check, which a second Supabase project would otherwise only fail
   * on its signature. That is one control; this is the one that keeps holding if
   * a secret is ever shared between projects or reused from an old one. */
  describe('issuer verification (SUPABASE_JWT_ISSUER set)', () => {
    const ISSUER = 'https://abcdefgh.supabase.co/auth/v1';

    let guard: JwtAuthGuard;

    beforeEach(async () => {
      guard = await build({ SUPABASE_JWT_SECRET: SECRET, SUPABASE_JWT_ISSUER: ISSUER });
    });

    it('accepts a token issued by the configured project', async () => {
      const { context, request } = contextFor(`Bearer ${validToken({ iss: ISSUER })}`);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.id).toBe('user-1');
    });

    /** Validly signed by *this* secret and still refused, which is the whole
     * point: the signature cannot distinguish projects that share one. */
    it('rejects a correctly signed token issued by another project', async () => {
      const { context } = contextFor(
        `Bearer ${validToken({ iss: 'https://zyxwvuts.supabase.co/auth/v1' })}`,
      );

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with no iss claim', async () => {
      const { context } = contextFor(`Bearer ${validToken()}`);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    /** Configured by copy-paste, so surrounding whitespace is the likely typo and
     * it would otherwise present as every request in the environment being
     * unauthorized. */
    it('trims the configured issuer', async () => {
      const padded = await build({
        SUPABASE_JWT_SECRET: SECRET,
        SUPABASE_JWT_ISSUER: `  ${ISSUER}  `,
      });
      const { context } = contextFor(`Bearer ${validToken({ iss: ISSUER })}`);

      await expect(padded.canActivate(context)).resolves.toBe(true);
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

    /** The message matters, not just the type. This path threw
     * `UnauthorizedException('Invalid token')` inside a `try` whose own `catch`
     * matched it and rethrew it as `Token validation failed: Invalid token` — the
     * guard wrapping its own exception. */
    it('rejects when Supabase reports an error, without wrapping its own exception', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
      const { context } = contextFor('Bearer any-opaque-token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid token');
    });

    /** A real failure of the call — the network, a paused project — still gets
     * described, because that one is not a decision this guard made. */
    it('describes a thrown transport error rather than swallowing it', async () => {
      mockGetUser.mockRejectedValue(new Error('fetch failed'));
      const { context } = contextFor('Bearer any-opaque-token');

      await expect(guard.canActivate(context)).rejects.toThrow(/Token validation failed/);
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
