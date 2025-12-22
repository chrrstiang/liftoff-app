import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch() // This decorator tells NestJS to catch ALL exceptions
export class GlobalExceptionFilter implements ExceptionFilter {
  // This method gets called whenever an unhandled exception occurs
  catch(exception: HttpException, host: ArgumentsHost) {
    console.log('🔥 Exception caught by filter:', exception);

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;

    // Determine type of exception (HTTP or unknown)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;

      console.log(`📝 HTTP Exception: ${status} - ${message}`);
    } else {
      // If it's an unexpected error (like database crash, network error)
      console.error('💥 Unexpected error:', exception);
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }

    // Create the response object
    const errorResponse = {
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    // Send the response back to the client
    response.status(status).json(errorResponse);
  }
}
