import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { UseFilters, UseGuards } from '@nestjs/common';
import { Server } from 'socket.io';
import { ChatService } from '../services/chat.service';
import { GroupRealtimeService } from '../services/group-realtime.service';
import { wsPayload } from 'src/common/guards/wsGuards/wsPayload.guard';
import { wsIsMemberChat } from 'src/common/guards/wsGuards/wsIsmemberChat.guard';
import { SocketAuth } from 'src/common/types/SocketAuth.type';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { chatRoom } from 'src/common/utils/roomCreator.utils';
import { ChatId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { WsExceptionFilter } from 'src/common/filters/ws-exception.filter';
import { num, serializeChat } from 'src/common/utils/ws-serializer.utils';

@WebSocketGateway()
@UseGuards(wsPayload)
@UseFilters(new WsExceptionFilter())
export class ChatGateway implements OnGatewayDisconnect, OnGatewayInit {
    constructor(
        private readonly chatService: ChatService,
        private readonly groupRealtime: GroupRealtimeService,
    ) {}

    /** REST-side group mutations fire room events through this server too. */
    afterInit(server: Server): void {
        this.groupRealtime.setServer(server);
    }

    @WebSocketServer()
    private server: Server;

    async handleDisconnect(client: SocketAuth) {
        const user = client.data.user;
        if (!user) return;

        const chatId = client.data.chatId;
        if (chatId) await this.onChatLeft(chatId);
    }

    @SubscribeMessage('getAllChats')
    async getAllChats(@ConnectedSocket() client: SocketAuth) {
        const chats = await this.chatService.getUserChats(client.data.user);

        // Serialized wire rows: numeric ids + lastMessage/preview in the exact
        // shape `chatlist:updated` emits.
        return { ok: true, data: chats.map(serializeChat) };
    }

    @SubscribeMessage('joinChat')
    @UseGuards(wsIsMemberChat)
    async joinChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        const chatId = dto.chatId;
        const user = client.data.user;
        const prev = client.data.chatId;

        if (prev === chatId) {
            // Self-healing: a socket that kept `data.chatId` but lost the room
            // (server restart / reconnect) must be re-added before it expects
            // room broadcasts again.
            await client.join(chatRoom(chatId));
            const info = await this.chatInfo(chatId, user.sub);
            // Legacy per-client event, kept for compatibility; the ack is the
            // completion signal.
            client.emit('chatInfo', info);
            return { ok: true, data: info };
        }
        if (prev) await this.leaveCurrentChat(client);

        await client.join(chatRoom(chatId));
        client.data.chatId = chatId;

        await this.emitSeen(chatId, user);
        await this.emitOnlineCount(chatId);

        const info = await this.chatInfo(chatId, user.sub);
        client.emit('chatInfo', info);

        return { ok: true, data: info };
    }

    @SubscribeMessage('leaveChat')
    async leaveChat(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto?: { chatId?: ChatId },
    ) {
        const chatId = dto?.chatId;
        // A late/duplicate leave from a previously open chat must not remove
        // the user from the chat they just joined.
        if (typeof chatId === 'number' && client.data.chatId !== chatId) {
            return { ok: true };
        }
        await this.leaveCurrentChat(client);
        return { ok: true };
    }

    @SubscribeMessage('userTyping')
    typingStart(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        this.broadcastTyping(client, dto.chatId, 'typing:start');
        return { ok: true };
    }

    @SubscribeMessage('userEndTyping')
    typingStop(
        @ConnectedSocket() client: SocketAuth,
        @MessageBody() dto: { chatId: ChatId },
    ) {
        this.broadcastTyping(client, dto.chatId, 'typing:stop');
        return { ok: true };
    }

    /** Serialized chat + per-caller role/permission/count extras. */
    private async chatInfo(chatId: ChatId, userId: JwtPayload['sub']) {
        const info = serializeChat(
            (await this.chatService.getInfoChat(chatId)) as Chat,
        );
        const summary = await this.chatService.getChatSummary(chatId, userId);
        return { ...info, ...summary };
    }

    private broadcastTyping(
        client: SocketAuth,
        chatId: ChatId,
        event: 'typing:start' | 'typing:stop',
    ) {
        if (client.data.chatId !== chatId) return;

        client.to(chatRoom(chatId)).emit(event, {
            chatId: num(chatId),
            userId: client.data.user.sub,
        });
    }

    private async leaveCurrentChat(client: SocketAuth) {
        const chatId = client.data.chatId;
        if (!chatId) return;

        await client.leave(chatRoom(chatId));
        client.data.chatId = undefined;

        this.server.to(chatRoom(chatId)).emit('typing:stop', {
            chatId: num(chatId),
            userId: client.data.user.sub,
        });
        await this.onChatLeft(chatId);
    }

    private async onChatLeft(chatId: ChatId) {
        await this.emitOnlineCount(chatId);
    }

    private async emitSeen(chatId: ChatId, user: JwtPayload) {
        const lastSeenId = await this.chatService.seening(chatId, user);
        this.server.to(chatRoom(chatId)).emit('seen', {
            chatId: num(chatId),
            userId: num(user.sub),
            lastSeenId: lastSeenId === null ? null : num(lastSeenId),
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
