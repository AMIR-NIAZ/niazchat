import {
    ConnectedSocket,
    MessageBody,
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
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { ChatId } from 'src/common/types/brands.type';

@WebSocketGateway()
@UseGuards(wsPayload)
export class ChatGateway implements OnGatewayDisconnect {
    @WebSocketServer()
    private server: Server;
    constructor(private readonly chatsService: ChatService) {}

    @SubscribeMessage('getAllChats')
    async handleMessage(@ConnectedSocket() client: SocketAuth) {
        const chats: Chat[] = await this.chatsService.getUserChats(
            client.data.user,
        );

        this.server.to(client.id).emit('getAllChats', chats);
    }

    @SubscribeMessage('joinChat')
    @UseGuards(wsIsMemberChat)
    async joinChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
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

    private async getMemberChat(chatName: string) {
        const countUser = (await this.server.to(chatName).fetchSockets())
            .length;
        this.server.to(chatName).emit('countUsersOnline', countUser);
    }

    private async seenChat(chatId: ChatId, user: JwtPayload) {
        const lastSeenId = await this.chatsService.seening(chatId, user);

        this.server.to(`chat:${chatId}`).emit('seen', {
            chatId,
            userId: user.sub,
            lastSeenId,
        });
    }

    async handleDisconnect(client: SocketAuth) {
        const room = client.rooms[1];
        if (room) {
            this.getMemberChat(room);
            await this.seenChat(room, client.data.user);
        }
    }
}
