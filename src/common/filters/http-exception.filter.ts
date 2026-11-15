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
        let message: string | string[] = 'Internal server error';
        // Extra, explicit payload for errors that need one (e.g. a 409 that
        // returns the contact already saved). Only `item` is forwarded.
        let extra: object = {};

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res: string | object = exception.getResponse();
            if (typeof res === 'string') {
                message = res;
            } else if ('message' in res) {
                const candidate = (res as { message?: unknown }).message;
                if (typeof candidate === 'string' || Array.isArray(candidate)) {
                    message = candidate as string | string[];
                }
            }
            if (typeof res === 'object' && res !== null && 'item' in res) {
                const item = (res as { item?: unknown }).item;
                if (item !== undefined) {
                    extra = { item };
                }
            }
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
            ...extra,
        };
        return response.status(status).json(errorResponse);
    }
}
