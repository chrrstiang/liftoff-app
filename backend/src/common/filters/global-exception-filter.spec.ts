import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception-filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });

    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/users/profile', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost;
  });

  const responseBody = () => json.mock.calls[0][0] as Record<string, unknown>;

  it('wraps the response in the standard envelope', () => {
    filter.catch(new NotFoundException('Athlete not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(responseBody()).toEqual({
      statusCode: 404,
      message: 'Athlete not found',
      timestamp: expect.any(String),
      path: '/users/profile',
      method: 'POST',
    });
  });

  it('preserves the per-field message array from ValidationPipe', () => {
    // This is the shape ValidationPipe throws. exception.message would only be
    // "Bad Request Exception", so the detail has to come off the response body.
    const validationError = new BadRequestException({
      statusCode: 400,
      message: ['first_name should not be empty', 'last_name should not be empty'],
      error: 'Bad Request',
    });

    filter.catch(validationError, host);

    expect(responseBody().message).toEqual([
      'first_name should not be empty',
      'last_name should not be empty',
    ]);
  });

  it('keeps the message of a manually thrown exception', () => {
    filter.catch(new BadRequestException('Federation is required to validate division'), host);

    expect(responseBody().message).toBe('Federation is required to validate division');
  });

  it('masks non-HTTP exceptions as a 500 without leaking details', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    filter.catch(new Error('connection terminated: password authentication failed'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(responseBody().message).toBe('Internal server error');
    expect(JSON.stringify(responseBody())).not.toContain('password');

    consoleError.mockRestore();
  });

  it('handles a thrown non-Error value', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    filter.catch('something went sideways', host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(responseBody().message).toBe('Internal server error');

    consoleError.mockRestore();
  });
});
