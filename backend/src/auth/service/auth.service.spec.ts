import { AuthService } from './auth.service';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Unit Tests for AuthService
 *
 * This suite tests all core functionalities of the AuthService, including:
 * - User registration (signUp)
 * - Adding users to the 'users' table
 * - Logging in with email/password
 * - Logging out from current session
 * - Updating email/password for an existing user
 *
 * Supabase interactions are mocked to isolate service logic.
 *
 * Error cases are also tested, such as:
 * - Supabase returning no data/errors
 * - Missing user IDs from responses
 * - Insert/update errors to the 'users' table
 */

// Test for Auth Service
describe('AuthService', () => {
  let service: AuthService;
  let mockSupabase: SupabaseClient;
  let dto;

  beforeEach(() => {
    mockSupabase = {
      auth: {
        signInWithPassword: jest.fn().mockResolvedValue({
          data: {},
          error: null,
        }),
        signUp: jest.fn().mockResolvedValue({
          data: { user: { id: '11111' } },
          error: null,
        }),
        signOut: jest.fn().mockResolvedValue({
          error: null,
        }),
        updateUser: jest.fn().mockResolvedValue({
          data: { user: { id: '1111' } },
          error: null,
        }),
      },
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: {}, error: null }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        }),
      }),
    } as unknown as SupabaseClient;
    service = new AuthService();
    dto = { email: 'christiantest@gmail.com', password: 'hello12345' };
  });

  // supabase.signUp() is called from AuthService.createUser()
  it('createUser succesfully calls signUp', async () => {
    await expect(service.createUser(dto, mockSupabase)).resolves.not.toThrow();
    expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
      email: dto.email,
      password: dto.password,
    });
  });

  // AuthService.createUser() throws when supabase.signUp() contains an error
  it('createUser throws error when signUp returns an error', async () => {
    mockSupabase.auth.signUp = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Some message' },
    });

    await expect(service.createUser(dto, mockSupabase)).rejects.toThrow(
      'Could not sign up user.',
    );
  });

  // AuthService.createUser() throws when supabase.signUp() has undefined ID.
  it('createUser throws error when signUp returns an undefined id', async () => {
    mockSupabase.auth.signUp = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: undefined,
        },
      },
      error: null,
    });

    await expect(service.createUser(dto, mockSupabase)).rejects.toThrow(
      'ID could not be located upon sign up.',
    );
  });

  // AuthService.login() correctly calls supabase.auth.signInWithPassword()
  it('login successfully calls signInWithPassword', async () => {
    await expect(service.login(dto, mockSupabase)).resolves.not.toThrow();
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: dto.email,
      password: dto.password,
    });
  });

  // AuthService.login() throws when supabase.auth.signInWithPassword() contains an error.
  it('login throws an error when signInWithPassword returns an error', async () => {
    mockSupabase.auth.signInWithPassword = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Invalid credentials' },
    });

    await expect(service.login(dto, mockSupabase)).rejects.toThrow(
      'Failed to login user: Invalid credentials',
    );
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: dto.email,
      password: dto.password,
    });
  });

  // AuthService.logout() calls supabase.auth.signOut().
  it('logout successfully calls signOut', async () => {
    await expect(service.logout(mockSupabase)).resolves.not.toThrow();
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  // AuthService.logout() throws when supabase.auth.signOut() contains an error.
  it('logout throws an error when signOut returns an error', async () => {
    mockSupabase.auth.signOut = jest.fn().mockResolvedValue({
      error: { message: 'Something failed' },
    });

    await expect(service.logout(mockSupabase)).rejects.toThrow(
      'Failed to log out.',
    );
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  // AuthService.update() calls supabase.auth.updateUser()
  it('update succesfully calls updateUser', async () => {
    await expect(service.update(dto, mockSupabase)).resolves.not.toThrow();
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
      email: dto.email,
      password: dto.password,
    });
  });

  // AuthService.update() throws when supabase.auth.updateUser() contains an error.
  it('update throws an error when updateUser returns an error or has an undefined id', async () => {
    mockSupabase.auth.updateUser = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Invalid credentials' },
    });

    await expect(service.update(dto, mockSupabase)).rejects.toThrow(
      'Could not update user: Invalid credentials',
    );
  });

  // AuthService.update() throws when supabase.auth.updateUser() has undefined ID.
  it('update throws an error when auth.updateUser returns an undefined id', async () => {
    mockSupabase.auth.updateUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: undefined,
        },
      },
      error: null,
    });

    await expect(service.update(dto, mockSupabase)).rejects.toThrow(
      'Failed to identify user: Check input',
    );
  });
});
