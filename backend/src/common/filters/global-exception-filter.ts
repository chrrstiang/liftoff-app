import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

/** Catches every exception and normalizes it into a single response shape:
 * { statusCode, message, timestamp, path, method }
 *
 * Registered globally in main.ts.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = GlobalExceptionFilter.extractMessage(exception);
    } else {
      // Unexpected (DB driver crash, network failure, thrown non-Error, ...).
      // Log the real cause but never leak it to the client.
      console.error('Unexpected error:', exception);
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    });
  }

  /** Pulls the useful message out of an HttpException.
   *
   * `exception.message` is lossy for validation errors — ValidationPipe puts the
   * per-field messages on the response body and leaves `message` as the generic
   * "Bad Request Exception". So prefer the response body, which may be a string
   * (manually thrown exceptions) or an object with a `message` string/array.
   */
  private static extractMessage(exception: HttpException): unknown {
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    const bodyMessage = (body as { message?: unknown }).message;
    return bodyMessage ?? exception.message;
  }
}
