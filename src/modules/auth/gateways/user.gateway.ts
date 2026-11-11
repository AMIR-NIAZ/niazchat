import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { JwtAppService } from '../services/jwt.service';
import { UserService } from '../services/user.service';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { userRoom } from 'src/common/utils/roomCreator.utils';

/** Announce `auth:expired` this long before the handshake token expires. */
const TOKEN_EXPIRY_WARNING_MS = 5_000;
/** Grace period after the warning before the socket is dropped. */
const AUTH_EXPIRY_GRACE_MS = 5_000;

/**
 * Joins every authenticated socket to its personal `user:<id>` room so
 * personal events (`chatlist:updated`, sticky presence) reach the client even
 * outside a chat screen.
 *
 * Auth runs at connection time through an io middleware: without it
 * `client.data.user` is undefined in `handleConnection` (Nest guards only run
 * for events), so the room was never joined and personal events were lost.
 */
@WebSocketGateway()
export class UserGateway
    implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
    @WebSocketServer()
    private server: Server;

    /** Per-socket timers that announce an expiring handshake token. */
    private readonly tokenExpiryTimers = new Map<
        string,
        ReturnType<typeof setTimeout>
    >();

    constructor(
        private readonly jwtService: JwtAppService,
        private readonly userService: UserService,
    ) {}

    afterInit(server: Server): void {
        const key = Symbol.for('niazchat.ws.connection.auth');
        const holder = server as unknown as Record<symbol, unknown>;
        if (holder[key]) return;
        holder[key] = true;

        server.use((socket, next) => {
            void (async (): Promise<void> => {
                const token = this.getToken(socket as SocketAuth);
                (socket as SocketAuth).data.user =
                    await this.jwtService.verifyAccessToken(token);
                next();
            })().catch((error) => {
                next(new Error(`token in valid, ${error}`));
            });
        });
    }

    async handleConnection(client: SocketAuth) {
        const user = client.data.user;
        if (!user) return;

        await client.join(userRoom(user.sub));

        const sockets = await this.server.in(userRoom(user.sub)).fetchSockets();
        if (sockets.length === 1) await this.userService.onlineUser(user);

        this.scheduleTokenExpiry(client);
    }

    async handleDisconnect(client: SocketAuth) {
        this.clearTokenExpiry(client.id);
        const user = client.data.user;
        if (!user) return;

        const remaining = await this.server
            .in(userRoom(user.sub))
            .fetchSockets();
        if (remaining.length === 0) await this.userService.offlineUser(user);
    }

    /**
     * The handshake header validates every guarded event. Once that token
     * expires the socket stays connected but every event fails with
     * `jwt expired`, and live updates silently stop. Warn just before `exp`
     * so the client refreshes + reconnects, and drop the socket after a short
     * grace period if it did not.
     */
    private scheduleTokenExpiry(client: SocketAuth): void {
        this.clearTokenExpiry(client.id);
        const exp = client.data.user?.exp;
        if (typeof exp !== 'number' || !Number.isFinite(exp)) return;

        const delay = exp * 1000 - Date.now() - TOKEN_EXPIRY_WARNING_MS;
        if (delay <= 0) return;

        const warnTimer = setTimeout((): void => {
            client.emit('auth:expired', { graceMs: AUTH_EXPIRY_GRACE_MS });
            const closeTimer = setTimeout((): void => {
                this.tokenExpiryTimers.delete(client.id);
                client.disconnect(true);
            }, AUTH_EXPIRY_GRACE_MS);
            this.tokenExpiryTimers.set(client.id, closeTimer);
        }, delay);
        this.tokenExpiryTimers.set(client.id, warnTimer);
    }

    private clearTokenExpiry(socketId: string): void {
        const timer = this.tokenExpiryTimers.get(socketId);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.tokenExpiryTimers.delete(socketId);
    }

    private getToken(client: SocketAuth): string {
        const authHeader = client.handshake.headers?.authorization;
        if (
            typeof authHeader !== 'string' ||
            !authHeader.startsWith('Bearer ')
        ) {
            throw new Error('token in valid');
        }
        return authHeader.split(' ')[1];
    }
}
