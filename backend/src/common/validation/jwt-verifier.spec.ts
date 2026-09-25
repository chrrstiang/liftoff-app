import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { JwtVerifier } from './jwt-verifier';
import { SupabaseService } from 'src/supabase/supabase.service';

/** Verifying a Supabase access token.
 *
 * ⚠️ **These moved here wholesale from `auth-guard.spec.ts`** when the verifier was
 * split out. They did not change, because the code did not — the guard delegates
 * to this class and the class is the same implementation. What is left in the
 * guard's own spec is the part that is genuinely about HTTP: reading the header.
 *
 * This is the entire trust boundary — there is no RLS behind it — so these cover
 * the forgeries as much as the happy path: a flipped signature bit, a token signed
 * with the wrong secret, `alg: none`, an algorithm swap, and an expired or
 * never-expiring token.
 *
 * Supabase is mocked with a `@nestjs/testing` provider override, so nothing here
 * touches the network. The mock doubles as the assertion that local mode never
 * calls out.
 */
describe('JwtVerifier', () => {
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

  const build = async (env: Record<string, string | undefined>): Promise<JwtVerifier> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtVerifier,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      ],
    }).compile();

    return module.get<JwtVerifier>(JwtVerifier);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('local verification (SUPABASE_JWT_SECRET set)', () => {
    let verifier: JwtVerifier;

    beforeEach(async () => {
      verifier = await build({ SUPABASE_JWT_SECRET: SECRET });
    });

    it('accepts a validly signed, unexpired token', async () => {
      await expect(verifier.verify(validToken())).resolves.toMatchObject({
        id: 'user-1',
        email: 'user@example.invalid',
      });
    });

    it('never calls Supabase on the local path', async () => {
      await verifier.verify(validToken());

      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('rejects a token whose signature has been tampered with', async () => {
      const token = validToken();
      const [header, payload, signature] = token.split('.');
      const flipped = signature.slice(0, -1) + (signature.at(-1) === 'A' ? 'B' : 'A');

      await expect(verifier.verify(`${header}.${payload}.${flipped}`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token whose payload was edited to impersonate another user', async () => {
      const token = validToken();
      const [header, , signature] = token.split('.');
      const forged = encode({ ...baseClaims, sub: 'someone-else', exp: 99999999999 });

      await expect(verifier.verify(`${header}.${forged}.${signature}`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with a different secret', async () => {
      await expect(verifier.verify(validToken({}, { secret: OTHER_SECRET }))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    /** `timingSafeEqual` throws on a length mismatch, so the cheap length check
     * has to come first. */
    it('rejects a signature of the wrong length without throwing from timingSafeEqual', async () => {
      const [header, payload] = validToken().split('.');

      await expect(verifier.verify(`${header}.${payload}.tooshort`)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      await expect(
        verifier.verify(validToken({ exp: Math.floor(Date.now() / 1000) - 1 })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with no exp claim, rather than treating it as never expiring', async () => {
      const { ...withoutExp } = baseClaims;

      await expect(verifier.verify(sign(withoutExp))).rejects.toThrow(UnauthorizedException);
    });

    it('rejects alg: none even when the rest of the token is well formed', async () => {
      const token = validToken({}, { header: { alg: 'none', typ: 'JWT' } });

      await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-HS256 alg even when the HMAC would otherwise match', async () => {
      const token = validToken({}, { header: { alg: 'HS512', typ: 'JWT' } });

      await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedException);
    });

    /** Algorithm confusion: the attacker names an asymmetric algorithm hoping the
     * verifier will treat a public key as an HMAC secret. */
    it('rejects an RS256 header', async () => {
      const token = validToken({}, { header: { alg: 'RS256', typ: 'JWT' } });

      await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with an unexpected aud', async () => {
      await expect(verifier.verify(validToken({ aud: 'some-other-audience' }))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts an aud array that contains the expected audience', async () => {
      await expect(
        verifier.verify(validToken({ aud: ['authenticated', 'other'] })),
      ).resolves.toMatchObject({ id: 'user-1' });
    });

    /** ⚠️ **Absence used to pass.** The check ran only when `aud` was present, so
     * the token that most wanted to skip it — one whose audience is wrong or
     * missing — was the one that did. */
    it('rejects a token with no aud claim, rather than skipping the check', async () => {
      const { aud: _aud, ...withoutAud } = baseClaims;

      await expect(
        verifier.verify(sign({ ...withoutAud, exp: Math.floor(Date.now() / 1000) + 3600 })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with no sub claim', async () => {
      const { sub: _sub, ...withoutSub } = baseClaims;

      await expect(
        verifier.verify(sign({ ...withoutSub, exp: Math.floor(Date.now() / 1000) + 3600 })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token that is not three segments', async () => {
      await expect(verifier.verify('not.a.jwt.at.all')).rejects.toThrow(UnauthorizedException);
    });

    /** `iss` is checked only when `SUPABASE_JWT_ISSUER` names one, which is why
     * every test above — none of which set it — passes without an `iss` claim. */
    it('ignores iss when no expected issuer is configured', async () => {
      await expect(
        verifier.verify(validToken({ iss: 'https://elsewhere/auth/v1' })),
      ).resolves.toMatchObject({ id: 'user-1' });
    });

    /** ⚠️ **What the socket gateway needs and the guard does not.** A connection
     * that authenticates once and then runs indefinitely is a live vulnerability,
     * and `exp` is what lets it schedule its own disconnect. */
    it('reports the token exp through verifyClaims', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;

      await expect(verifier.verifyClaims(validToken({ exp }))).resolves.toMatchObject({
        exp,
        user: { id: 'user-1' },
      });
    });
  });

  /** The issuer check, which a second Supabase project would otherwise only fail
   * on its signature. That is one control; this is the one that keeps holding if a
   * secret is ever shared between projects or reused from an old one. */
  describe('issuer verification (SUPABASE_JWT_ISSUER set)', () => {
    const ISSUER = 'https://abcdefgh.supabase.co/auth/v1';

    let verifier: JwtVerifier;

    beforeEach(async () => {
      verifier = await build({ SUPABASE_JWT_SECRET: SECRET, SUPABASE_JWT_ISSUER: ISSUER });
    });

    it('accepts a token issued by the configured project', async () => {
      await expect(verifier.verify(validToken({ iss: ISSUER }))).resolves.toMatchObject({
        id: 'user-1',
      });
    });

    /** Validly signed by *this* secret and still refused, which is the whole
     * point: the signature cannot distinguish projects that share one. */
    it('rejects a correctly signed token issued by another project', async () => {
      await expect(
        verifier.verify(validToken({ iss: 'https://zyxwvuts.supabase.co/auth/v1' })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token with no iss claim', async () => {
      await expect(verifier.verify(validToken())).rejects.toThrow(UnauthorizedException);
    });

    /** Configured by copy-paste, so surrounding whitespace is the likely typo and
     * it would otherwise present as every request in the environment being
     * unauthorized. */
    it('trims the configured issuer', async () => {
      const padded = await build({
        SUPABASE_JWT_SECRET: SECRET,
        SUPABASE_JWT_ISSUER: `  ${ISSUER}  `,
      });

      await expect(padded.verify(validToken({ iss: ISSUER }))).resolves.toMatchObject({
        id: 'user-1',
      });
    });
  });

  describe('remote fallback (SUPABASE_JWT_SECRET unset)', () => {
    let verifier: JwtVerifier;

    beforeEach(async () => {
      verifier = await build({});
    });

    it('verifies through supabase.auth.getUser and returns the user it reports', async () => {
      const remoteUser = { id: 'remote-user', email: 'remote@example.invalid' };
      mockGetUser.mockResolvedValue({ data: { user: remoteUser }, error: null });

      await expect(verifier.verify('any-opaque-token')).resolves.toBe(remoteUser);
      expect(mockGetUser).toHaveBeenCalledWith('any-opaque-token');
    });

    /** The message matters, not just the type. This path threw
     * `UnauthorizedException('Invalid token')` inside a `try` whose own `catch`
     * matched it and rethrew it as `Token validation failed: Invalid token`. */
    it('rejects when Supabase reports an error, without wrapping its own exception', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });

      await expect(verifier.verify('any-opaque-token')).rejects.toThrow(UnauthorizedException);
      await expect(verifier.verify('any-opaque-token')).rejects.toThrow('Invalid token');
    });

    /** A real failure of the call — the network, a paused project — still gets
     * described, because that one is not a decision this class made. */
    it('describes a thrown transport error rather than swallowing it', async () => {
      mockGetUser.mockRejectedValue(new Error('fetch failed'));

      await expect(verifier.verify('any-opaque-token')).rejects.toThrow(/Token validation failed/);
    });

    it('does not verify locally, so a token this process could not have signed still goes remote', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'remote-user' } }, error: null });

      await expect(
        verifier.verify(validToken({}, { secret: OTHER_SECRET })),
      ).resolves.toBeDefined();
      expect(mockGetUser).toHaveBeenCalled();
    });

    /** ⚠️ `exp` is unknowable here: `getUser()` answers "is this good right now"
     * and does not hand back the claim set. A socket has to treat that as
     * "unknown" rather than "never" — see `VerifiedToken`. */
    it('reports an undefined exp on the remote path', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'remote-user' } }, error: null });

      await expect(verifier.verifyClaims('any-opaque-token')).resolves.toMatchObject({
        exp: undefined,
      });
    });
  });
});
