import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/supabase/supabase.service';
import {
  cleanupUsers,
  createAuthClient,
  createTestUser,
  requireLiveOptIn,
  type TestUser,
} from './helpers/fixtures';

/** The shape of a *real* Supabase access token, asserted against the live project.
 *
 * ⚠️ **This exists because `JwtAuthGuard`'s local path has no CI coverage at all.**
 * The e2e job does not set `SUPABASE_JWT_SECRET`, so every request in every other
 * spec goes through the remote `supabase.auth.getUser` fallback and never reaches
 * the HS256 verifier. Production *does* set it (`infra/ecs/task-definition.json`),
 * so the code CI exercises is not the code that runs.
 *
 * That gap is what makes a claim requirement dangerous to tighten: requiring `aud`
 * is correct only while Supabase actually sets it, and nothing here would have
 * noticed if it stopped. These tests do not run the guard — they check its
 * premises, on a token the project minted a moment ago. If Supabase ever changes
 * the token shape, this goes red on the next PR to `main` rather than 401ing every
 * authenticated request in production.
 *
 * No JWT secret needed: reading a claim is base64url, not verification.
 */
describe('Supabase access token claims (e2e)', () => {
  let user: TestUser;
  let supabase: ReturnType<SupabaseService['getClient']>;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    requireLiveOptIn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // No app is initialised: nothing here sends a request. The module exists only
    // to resolve the two Supabase clients the fixture needs.
    supabase = moduleFixture.get(SupabaseService).getClient();
    const config = moduleFixture.get(ConfigService);
    const authClient = createAuthClient(
      config.get<string>('SUPABASE_PROJECT_URL')!,
      config.get<string>('SUPABASE_SECRET_KEY')!,
    );

    user = await createTestUser(supabase, authClient, (id) => createdUserIds.push(id));
  });

  afterAll(async () => {
    await cleanupUsers(supabase, createdUserIds);
  });

  /** Decodes the payload segment. Deliberately not verified — the point is what
   * the token *says*, and the signature is the guard's job. */
  const claims = (): Record<string, unknown> =>
    JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

  it('signs with HS256, which is the only algorithm the guard accepts', () => {
    const header = JSON.parse(
      Buffer.from(user.token.split('.')[0], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(header.alg).toBe('HS256');
  });

  /** The premise behind requiring `aud` rather than checking it only when present.
   * The old code skipped the check for exactly the token that most wanted it
   * skipped; requiring it is only safe while this holds. */
  it('always carries aud: authenticated', () => {
    expect(claims().aud).toBe('authenticated');
  });

  it('carries a sub and an exp, neither of which the guard will infer', () => {
    expect(typeof claims().sub).toBe('string');
    expect(claims().sub).not.toBe('');
    expect(typeof claims().exp).toBe('number');
  });

  /** ⚠️ **The value `SUPABASE_JWT_ISSUER` must be set to**, printed rather than
   * hardcoded. The guard does not derive it from `SUPABASE_PROJECT_URL` on
   * purpose — a custom auth domain or a trailing slash would 401 every request in
   * the environment, and nothing in CI reaches that code to catch it. So the
   * suite reports the real value instead of a repo-side guess. */
  it('carries an iss, and reports it for SUPABASE_JWT_ISSUER', () => {
    const iss = claims().iss;

    expect(typeof iss).toBe('string');
    console.log(`SUPABASE_JWT_ISSUER for this project is: ${String(iss)}`);
  });
});
