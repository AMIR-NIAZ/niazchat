import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { UserService } from '../services/user.service';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { ChatId, UserId } from 'src/common/types/brands.type';

@WebSocketGateway()
export class UserGateway {
    @WebSocketServer()
    server: Server;

    constructor(private readonly userService: UserService) {}

    @SubscribeMessage('onlineUser')
    async onlineUser(@ConnectedSocket() client: SocketAuth) {
        await this.userService.onlineUser(client.data.user);
    }

    @SubscribeMessage('offlineUser')
    async offlineUser(@ConnectedSocket() client: SocketAuth) {
        await this.userService.offlineUser(client.data.user);
    }

    @SubscribeMessage('userTyping')
    typingStart(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
    ) {
        const userId: UserId = client.data.user.sub;

        client.to(`chat:${chatId}`).emit('typing:start', {
            chatId,
            userId,
        });
    }

    @SubscribeMessage('userEndTyping')
    typingStop(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
    ) {
        const userId: UserId = client.data.user.sub;

        client.to(`chat:${chatId}`).emit('typing:stop', {
            chatId,
            userId,
        });
    }
}
