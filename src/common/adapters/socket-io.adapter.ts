import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO server options shared by every gateway.
 *
 * Defaults are 25 s ping / 20 s timeout: a half-dead mobile connection (Wi-Fi
 * gone, airplane mode, suspended radio) could stay "connected" client-side for
 * ~45 s while receiving nothing. A 10 s ping with an 8 s reply timeout detects
 * it in at most ~18 s, and the client reconnects with backoff + jitter.
 */
export const WS_HEARTBEAT_OPTIONS = {
    pingInterval: 10_000,
    pingTimeout: 8_000,
} as const;

export class SocketIoAdapter extends IoAdapter {
    createIOServer(port: number, options?: ServerOptions): Server {
        const server = super.createIOServer(port, {
            ...options,
            ...WS_HEARTBEAT_OPTIONS,
        }) as Server;
        return server;
    }
}
