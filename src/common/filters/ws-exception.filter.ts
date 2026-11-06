import { HttpException, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

/**
 * Answers WS request/response events through the client's ack callback.
 *
 * Nest only acks a handler that RETURNS a value; errors from guards, pipes and
 * handlers previously became a separate `exception` event. This filter
 * normalizes everything to `{ ok: false, message, status }` on the ack, so the
 * client needs one error channel. When the caller did not provide an ack
 * callback, falls back to emitting `exception` on the client socket.
 *
 * Wiring (verified against installed @nestjs/websockets + platform-socket.io):
 * handler args are `[client, data, ack?, pattern]`, so the ack callback is the
 * first function-typed argument (the pattern is a string).
 */
@Injectable() // must be injectable so it can be instantiated with `new`
export class WsExceptionFilter {
    catch(
        exception: unknown,
        host: import('@nestjs/common').ArgumentsHost,
    ): void {
        const args = host.getArgs();
        const client = args[0] as {
            emit?: (event: string, payload: unknown) => void;
        };

        const status = this.statusOf(exception);
        const message = this.messageOf(exception);
        const payload = { ok: false, message, status };

        const ack = args.find(
            (arg): arg is (response: unknown) => void =>
                typeof arg === 'function',
        );
        if (typeof ack === 'function') {
            ack(payload);
            return;
        }
        // No ack callback — keep the legacy error channel so errors still surface.
        if (client && typeof client.emit === 'function') {
            client.emit('exception', payload);
        }
    }
    private statusOf(exception: unknown): number {
        if (exception instanceof HttpException) {
            return exception.getStatus();
        }
        return 400;
    }

    private messageOf(exception: unknown): string {
        if (exception instanceof HttpException) {
            const res: unknown = exception.getResponse();
            if (typeof res === 'string') return res;
            if (typeof res === 'object' && res !== null) {
                const message: unknown = (res as Record<string, unknown>)[
                    'message'
                ];
                if (Array.isArray(message)) {
                    return message.map(String).join(', ');
                }
                if (typeof message === 'string') return message;
            }
        }
        if (exception instanceof WsException) {
            return stringifyError(exception.getError());
        }
        if (exception instanceof Error) {
            return exception.message;
        }
        return 'unknown error';
    }
}

function stringifyError(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return 'unknown error';
    try {
        return JSON.stringify(value);
    } catch {
        return 'unknown error';
    }
}
