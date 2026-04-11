import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { ChatService } from '../services/chat.service';
import { Server } from 'socket.io';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { UseGuards } from '@nestjs/common';
import { Chat } from '../entities/chat.entity';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';

@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
    constructor(private readonly chatsService: ChatService) {}

    handleConnection() {
        console.log('clinet connected');
    }

    @SubscribeMessage('getAllChats')
    async handleMessage(@ConnectedSocket() client: SocketAuth) {
        const chats: Chat[] = await this.chatsService.getUserChats(
            client.data.user,
        );

        this.server.to(client.id).emit('getAllChats', chats);
    }

    @UseGuards(wsPayload)
    @SubscribeMessage('joinChat')
    async joinChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: number,
    ) {
        const lastChat: string = Array.from(client.rooms)[1];
        if (lastChat) {
            client.leave(lastChat);
            await this.seenChat(chatId, client.data.user);
            await this.getMemberChat(lastChat);
        }

        client.join(`chat:${chatId}`);
        await this.seenChat(chatId, client.data.user);
        await this.getMemberChat(`chat:${chatId}`);

        const chatInfo = await this.chatsService.getInfoChat(chatId);
        client.emit('chatInfo', chatInfo);
    }

    async handleDisconnect(client: SocketAuth) {
        if (client.rooms[1]) {
            this.getMemberChat(client.rooms[1]);
            await this.seenChat(client.rooms[1], client.data.user);
        }
    }

    private async getMemberChat(chatName: string) {
        const countUser = (await this.server.to(chatName).fetchSockets())
            .length;
        this.server.to(chatName).emit('countUsersOnline', countUser);
    }

    private async seenChat(chatId: number, user: JwtPayload) {
        const lastSeenId = await this.chatsService.seening(chatId, user);

        this.server.to(`chat:${chatId}`).emit('seen', {
            chatId,
            userId: user.sub,
            lastSeenId,
        });
    }
}
