import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch()
export class HttpExceptionFilter<T> implements ExceptionFilter {
    catch(exception: T, host: ArgumentsHost) {
        const ctx: HttpArgumentsHost = host.switchToHttp();
        const response: Response = ctx.getResponse();
        let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
        let message: string = 'Internal server error';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res: string | object = exception.getResponse();
            message =
                typeof res === 'string' ? res : (res as any).message || message;
        } else if (exception instanceof QueryFailedError) {
            status = HttpStatus.BAD_REQUEST;
            message = exception.message;
        } else if (exception instanceof Error) {
            message = exception.message;
        }
        if (status === 403) message = 'user not access';
        // set interfase
        const errorResponse: object = {
            success: false,
            statusCode: status,
            message,
        };
        return response.status(status).json(errorResponse);
    }
}
