import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { UserService } from '../services/user.service';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { userRoom } from 'src/common/utils/roomCreator.utils';

@WebSocketGateway()
export class UserGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    private server: Server;

    constructor(private readonly userService: UserService) { }

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

        const remaining = await this.server.in(userRoom(user.sub)).fetchSockets();
        if (remaining.length === 0) await this.userService.offlineUser(user);
    }
}