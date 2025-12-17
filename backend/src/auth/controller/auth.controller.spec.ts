import { AuthController } from '../controller/auth.controller';
import { AuthService } from '../service/auth.service';
import { SupabaseService } from 'src/supabase/supabase.service';

/**
 * Unit Tests for AuthController
 * 
 * This suite tests:
 * - Controller interaction with service layer methods.
 * - Correctness of objects returned upon operation completion.
 */

describe('AuthController', () => {
  let controller: AuthController;
  // creates mocked versions, where all functions are defined as mocks.
  let mockAuthService: jest.Mocked<AuthService>;
  let mockSupabaseService: jest.Mocked<SupabaseService>;
  let dto;

  beforeEach(() => {

    dto = {email: "helloemail@gmail.com", password: "This is my password"}

    mockAuthService = {
      createUser: jest.fn(),
      login: jest.fn().mockResolvedValue({
        access_token: 'A token',
        user: ' Some user '
      }),
      logout: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    
    mockSupabaseService = {
      getClient: jest.fn().mockReturnValue({})
    } as unknown as jest.Mocked<SupabaseService>;
    

    controller = new AuthController(
      mockAuthService,
      mockSupabaseService
    );
  });

  it('should call createUser with DTO and Supabase client', async () => {
    const signup = await controller.signUp(dto);
    expect(mockAuthService.createUser).toHaveBeenCalledWith(dto, mockSupabaseService.getClient());
    expect(mockAuthService.createUser).toHaveBeenCalledTimes(1);
    expect(signup).toEqual({message: 'User created successfully'});
  });

  it('should call login with DTO and Supabase client', async () => {
    const login = await controller.login(dto);
    expect(mockAuthService.login).toHaveBeenCalledWith(dto, mockSupabaseService.getClient());
    expect(mockAuthService.login).toHaveBeenCalledTimes(1);
    expect(login.message).toEqual('Login successful');
  })

  it('should call logout with Supabase client', async () => {
    const logout = await controller.logout();
    expect(mockAuthService.logout).toHaveBeenCalled();
    expect(mockAuthService.logout).toHaveBeenCalledTimes(1);
    expect(logout).toEqual({ message: 'Logout successful' });
  })

  it('should call update with DTO and Supabase client', async () => {
    const update = await controller.update(dto);
    expect(mockAuthService.update).toHaveBeenCalledWith(dto, mockSupabaseService.getClient())
    expect(mockAuthService.update).toHaveBeenCalledTimes(1);
    expect(update).toEqual({message: 'User updated successfully'})
  })
});
