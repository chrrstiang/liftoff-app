import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './auth-guard';
import { JwtVerifier } from 'src/common/validation/jwt-verifier';
import { RequestWithUser } from 'src/common/types/request.interface';

/** What is left of this guard once verification moved to `JwtVerifier`: reading
 * the bearer token off the header, and putting the verified user on the request.
 *
 * ⚠️ **The forgery cases are not gone, they are in `jwt-verifier.spec.ts`** —
 * signature tampering, `alg: none`, algorithm confusion, expiry, `aud`, `iss`, the
 * remote fallback. They moved with the code they exercise. Do not re-add a token
 * fixture here; a second place that mints tokens is a second place that can
 * disagree about what a valid one looks like.
 *
 * The verifier is mocked, because everything below is about whether this guard
 * asks it at all and what it does with the answer.
 */
describe('JwtAuthGuard', () => {
  const user = { id: 'user-1', email: 'user@example.invalid' };
  const verify = jest.fn();

  let guard: JwtAuthGuard;

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

  beforeEach(async () => {
    jest.clearAllMocks();
    verify.mockResolvedValue(user);

    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: JwtVerifier, useValue: { verify } }],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('passes the bearer token to the verifier and attaches the user it names', async () => {
    const { context, request } = contextFor('Bearer some-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('some-token');
    expect(request.user).toBe(user);
  });

  it('rejects a request with no Authorization header without consulting the verifier', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer Authorization scheme', async () => {
    const { context } = contextFor('Basic some-token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  /** A `Bearer` with nothing after it yields `undefined`, which must read as "no
   * token" rather than being handed to the verifier as one. */
  it('rejects a Bearer header with no token', async () => {
    const { context } = contextFor('Bearer');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  /** The verifier already shaped this exception — the guard must not re-wrap it,
   * which is the bug the fallback path had before it was fixed. */
  it('propagates a verifier rejection unchanged', async () => {
    verify.mockRejectedValue(new UnauthorizedException('Invalid token'));
    const { context } = contextFor('Bearer forged');

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid token');
  });

  /** `await`ing the verifier is load-bearing: without it `request.user` is a
   * Promise, every downstream `req.user.id` is `undefined`, and the failure is a
   * 500 rather than a 401. */
  it('awaits the verifier rather than attaching a promise', async () => {
    const { context, request } = contextFor('Bearer some-token');

    await guard.canActivate(context);

    expect(request.user).not.toBeInstanceOf(Promise);
    expect(request.user.id).toBe('user-1');
  });
});
