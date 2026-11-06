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
    }

    async handleDisconnect(client: SocketAuth) {
        const user = client.data.user;
        if (!user) return;

        const remaining = await this.server
            .in(userRoom(user.sub))
            .fetchSockets();
        if (remaining.length === 0) await this.userService.offlineUser(user);
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
