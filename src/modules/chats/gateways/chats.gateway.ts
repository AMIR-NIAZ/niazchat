import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { Server } from 'socket.io';
import { ChatService } from '../services/chat.service';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { chatRoom } from 'src/common/utils/roomCreator.utils';
import { ChatId } from 'src/common/types/brands.type';

@WebSocketGateway()
@UseGuards(wsPayload)
export class ChatGateway implements OnGatewayDisconnect {
    constructor(private readonly chatService: ChatService) { }

    @WebSocketServer()
    private server: Server;

    async handleDisconnect(client: SocketAuth) {
        const user = client.data.user;
        if (!user) return;

        const chatId = client.data.chatId;
        if (chatId) await this.onChatLeft(chatId, user);
    }

    @SubscribeMessage('getAllChats')
    async getAllChats(@ConnectedSocket() client: SocketAuth) {
        const chats = await this.chatService.getUserChats(client.data.user);
        client.emit('getAllChats', chats);
    }

    @SubscribeMessage('joinChat')
    @UseGuards(wsIsMemberChat)
    async joinChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
    ) {
        const user = client.data.user;
        const prev = client.data.chatId;

        if (prev === chatId) return;
        if (prev) await this.leaveCurrentChat(client);

        await client.join(chatRoom(chatId));
        client.data.chatId = chatId;

        await this.emitSeen(chatId, user);
        await this.emitOnlineCount(chatId);

        client.emit('chatInfo', await this.chatService.getInfoChat(chatId));
    }

    @SubscribeMessage('leaveChat')
    async leaveChat(@ConnectedSocket() client: SocketAuth) {
        await this.leaveCurrentChat(client);
    }

    @SubscribeMessage('userTyping')
    typingStart(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
    ) {
        this.broadcastTyping(client, chatId, 'typing:start');
    }

    @SubscribeMessage('userEndTyping')
    typingStop(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() chatId: ChatId,
    ) {
        this.broadcastTyping(client, chatId, 'typing:stop');
    }

    private broadcastTyping(
        client: SocketAuth,
        chatId: ChatId,
        event: 'typing:start' | 'typing:stop',
    ) {
        if (client.data.chatId !== chatId) return;

        client.to(chatRoom(chatId)).emit(event, {
            chatId,
            userId: client.data.user.sub,
        });
    }

    private async leaveCurrentChat(client: SocketAuth) {
        const chatId = client.data.chatId;
        if (!chatId) return;

        await client.leave(chatRoom(chatId));
        client.data.chatId = undefined;

        this.server.to(chatRoom(chatId)).emit('typing:stop', {
            chatId,
            userId: client.data.user.sub,
        });
        await this.onChatLeft(chatId, client.data.user);
    }

    private async onChatLeft(chatId: ChatId, user: JwtPayload) {
        await this.emitSeen(chatId, user);
        await this.emitOnlineCount(chatId);
    }

    private async emitSeen(chatId: ChatId, user: JwtPayload) {
        const lastSeenId = await this.chatService.seening(chatId, user);
        this.server.to(chatRoom(chatId)).emit('seen', {
            chatId,
            userId: user.sub,
            lastSeenId,
        });
    }

    private async emitOnlineCount(chatId: ChatId) {
        const sockets = await this.server.in(chatRoom(chatId)).fetchSockets();
        const count = new Set(
            sockets.map((s) => (s.data as SocketAuth['data']).user.sub),
        ).size;
        this.server.to(chatRoom(chatId)).emit('countUsersOnline', count);
    }
}